"""Train Stage A.

    python -m starbuddy_ml.train --config configs/stage_a.yaml
    python -m starbuddy_ml.train --config configs/stage_a.yaml --overfit 4

`--overfit N` trains on N samples with augmentation off. It is the pipeline smoke
test: corner error must fall to roughly zero within a couple of hundred steps. If
it does not, the labels or the geometry are wrong and no amount of real data will
fix it.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
import yaml
from torch.utils.data import DataLoader

from .dataset import PanelDataset
from .metrics import summarise
from .model import PanelNet, compute_loss
from .schema import load_labels, split_by_session


def pick_device() -> torch.device:
    if torch.cuda.is_available():  # ROCm reports itself as cuda
        return torch.device("cuda")
    print("! no GPU visible to torch — falling back to CPU (slow). Check the ROCm wheel.")
    return torch.device("cpu")


@torch.no_grad()
def evaluate(
    model: PanelNet, loader: DataLoader, device: torch.device, batch_stats: bool = False
) -> dict[str, float]:
    model.eval()
    if batch_stats:
        # With only a handful of samples the BatchNorm running statistics never
        # settle, so eval mode measures something the training loop never saw and
        # the numbers disagree with the loss. Using batch statistics keeps the
        # --overfit smoke test measuring what it is meant to: whether the heads
        # can fit the labels at all. Never enable this for a real run — it leaks
        # the validation batch's own statistics into its prediction.
        for module in model.modules():
            if isinstance(module, torch.nn.modules.batchnorm._BatchNorm):
                module.train()
    preds: dict[str, list] = {"quad": [], "screen": [], "hud_colour": [], "occluded": []}
    targets: dict[str, list] = {"quad": [], "screen": [], "hud_colour": [], "occluded": []}
    for batch in loader:
        out = model(batch["image"].to(device))
        preds["quad"].append(out["quad"].float().cpu().numpy())
        preds["screen"].append(out["screen"].argmax(-1).cpu().numpy())
        preds["hud_colour"].append(out["hud_colour"].argmax(-1).cpu().numpy())
        preds["occluded"].append(out["occluded"].float().cpu().numpy())
        for key in targets:
            targets[key].append(batch[key].numpy())
    stacked_p = {k: np.concatenate(v) for k, v in preds.items()}
    stacked_t = {k: np.concatenate(v) for k, v in targets.items()}
    return summarise(stacked_p, stacked_t)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="configs/stage_a.yaml")
    parser.add_argument("--out", default=None, help="run directory (default: runs/stage_a-<timestamp>)")
    parser.add_argument("--overfit", type=int, default=0, help="train on N samples, no augmentation")
    parser.add_argument("--labels", default=None, help="override data.labels")
    parser.add_argument("--images", default=None, help="override data.images")
    args = parser.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text())
    if args.labels:
        cfg["data"]["labels"] = args.labels
    if args.images:
        cfg["data"]["images"] = args.images

    # A dataset exported from the app carries its own screen encoding, because
    # contributors can name a panel nobody has submitted before. When that file
    # is present it wins over the config, so a fresh export trains without
    # anyone hand-editing the screen list first.
    encoding = Path(cfg["data"]["labels"]).parent / "screens.yaml"
    if encoding.exists():
        screens = yaml.safe_load(encoding.read_text()).get("screens")
        if screens:
            print(f"using the screen encoding shipped with the dataset ({len(screens)} screens)")
            cfg["screens"] = screens
    run_dir = Path(args.out or f"runs/stage_a-{time.strftime('%Y%m%d-%H%M%S')}")
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "config.yaml").write_text(yaml.safe_dump(cfg, sort_keys=False))

    samples = load_labels(cfg["data"]["labels"])
    if not samples:
        raise SystemExit(f"no labels in {cfg['data']['labels']}")

    if args.overfit:
        train_samples = samples[: args.overfit]
        val_samples = train_samples
        augment = None
        epochs = max(cfg["train"]["epochs"], 200)
    else:
        train_samples, val_samples = split_by_session(
            samples, cfg["data"]["val_fraction"], cfg["data"]["seed"]
        )
        augment = cfg["augment"]
        epochs = cfg["train"]["epochs"]
    print(f"{len(train_samples)} train / {len(val_samples)} val samples")

    common = dict(
        images_dir=cfg["data"]["images"],
        size=cfg["model"]["input_size"],
        screens=cfg["screens"],
        hud_colours=cfg["hud_colours"],
    )
    train_set = PanelDataset(train_samples, augment=augment, **common)
    val_set = PanelDataset(val_samples, augment=None, **common)

    batch_size = min(cfg["train"]["batch_size"], len(train_set))
    workers = 0 if args.overfit else cfg["train"]["num_workers"]
    train_loader = DataLoader(train_set, batch_size=batch_size, shuffle=True, num_workers=workers, drop_last=False)
    val_loader = DataLoader(val_set, batch_size=batch_size, shuffle=False, num_workers=workers)

    device = pick_device()
    model = PanelNet(
        n_screens=len(cfg["screens"]),
        n_hud_colours=len(cfg["hud_colours"]),
        backbone=cfg["model"]["backbone"],
        pretrained=cfg["model"]["pretrained"] and not args.overfit,
    ).to(device)

    optimiser = torch.optim.AdamW(
        model.parameters(), lr=cfg["train"]["lr"], weight_decay=cfg["train"]["weight_decay"]
    )
    warmup = cfg["train"].get("warmup_epochs", 0)
    schedule = torch.optim.lr_scheduler.LambdaLR(
        optimiser,
        lambda e: (e + 1) / max(1, warmup) if e < warmup else 0.5 * (1 + np.cos(np.pi * (e - warmup) / max(1, epochs - warmup))),
    )
    # bf16 needs no gradient scaler, which is one less ROCm-specific failure mode.
    amp = cfg["train"]["amp"] and device.type == "cuda"

    best = float("inf")
    history = []
    for epoch in range(epochs):
        model.train()
        running = 0.0
        for batch in train_loader:
            batch = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=amp):
                out = model(batch["image"])
            loss, parts = compute_loss({k: v.float() for k, v in out.items()}, batch, cfg["loss"])
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            optimiser.step()
            running += loss.item()
        schedule.step()

        metrics = evaluate(model, val_loader, device, batch_stats=bool(args.overfit))
        metrics.update(epoch=epoch, train_loss=running / max(1, len(train_loader)), lr=schedule.get_last_lr()[0])
        history.append(metrics)
        print(
            f"epoch {epoch:3d}  loss {metrics['train_loss']:.4f}  "
            f"corner {metrics['corner_err_mean']:6.2f}  iou {metrics['quad_iou_mean']:.3f}  "
            f"screen {metrics['screen_acc']:.3f}"
        )

        if metrics["corner_err_mean"] < best:
            best = metrics["corner_err_mean"]
            torch.save(
                {"model": model.state_dict(), "config": cfg, "metrics": metrics},
                run_dir / "best.pt",
            )
        (run_dir / "history.jsonl").write_text("\n".join(json.dumps(h) for h in history) + "\n")

    print(f"best mean corner error {best:.2f} (normalised x1000) -> {run_dir / 'best.pt'}")


if __name__ == "__main__":
    main()
