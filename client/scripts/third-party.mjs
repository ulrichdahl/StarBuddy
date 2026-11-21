// The open-source components the desktop client ships, for Settings ›
// Credits and licenses: every Rust crate the build links (normal and build
// dependencies, all platforms) and every npm package the windows load.
//
//   node scripts/third-party.mjs        (from client/; runs before `npm run build`)
//
// Writes src/generated/third-party.json. Without cargo (a frontend-only
// build) the file already committed is kept as it is.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const client = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(client, "src/generated/third-party.json");

const repoOf = (r) => (typeof r === "string" ? r : r?.url ?? null)?.replace(/^git\+/, "").replace(/\.git$/, "") ?? null;

function rust() {
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", join(client, "src-tauri/Cargo.toml")], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  );
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const root = meta.resolve.root;
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const node = nodes.get(queue.pop());
    for (const dep of node?.deps ?? []) {
      // Dev-only dependencies are not in what ships.
      if (dep.dep_kinds.every((k) => k.kind === "dev")) continue;
      if (!seen.has(dep.pkg)) {
        seen.add(dep.pkg);
        queue.push(dep.pkg);
      }
    }
  }
  seen.delete(root);
  return [...seen]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p) => ({ name: p.name, version: p.version, license: p.license ?? (p.license_file ? "see its license file" : "unknown"), url: p.repository ?? p.homepage ?? `https://crates.io/crates/${p.name}` }));
}

function npm() {
  const found = new Map();
  const visit = (name, from) => {
    // Resolved the way Node does: nested first, then the top level.
    const candidates = [join(from, "node_modules", name, "package.json"), join(client, "node_modules", name, "package.json")];
    const file = candidates.find((f) => existsSync(f));
    if (!file) return;
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    const key = `${pkg.name}@${pkg.version}`;
    if (found.has(key)) return;
    found.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "unknown",
      url: repoOf(pkg.repository) ?? pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}`,
    });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dirname(file));
  };
  const own = JSON.parse(readFileSync(join(client, "package.json"), "utf8"));
  for (const dep of Object.keys(own.dependencies ?? {})) visit(dep, client);
  return [...found.values()];
}

const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
let rustList;
try {
  rustList = rust().sort(byName);
} catch (e) {
  if (existsSync(out)) {
    console.warn(`third-party: cargo metadata failed (${e.message.split("\n")[0]}); keeping ${out}`);
    process.exit(0);
  }
  throw e;
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ rust: rustList, npm: npm().sort(byName) }, null, 1) + "\n");
console.log(`third-party: ${rustList.length} crates, written to ${out}`);
