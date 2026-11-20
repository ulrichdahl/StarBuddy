// The updater's latest.json for one release, from the signed bundles in a
// folder: the AppImage for Linux, the NSIS installer for Windows. The deb,
// rpm and msi are left out; they are updated by downloading.
//
//   node update-manifest.mjs <bundles dir> <version> <download base url> [notes file]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const [dir, version, base, notesFile] = process.argv.slice(2);
if (!dir || !version || !base) {
  console.error("usage: update-manifest.mjs <bundles dir> <version> <download base url> [notes file]");
  process.exit(2);
}

const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const path = join(d, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
};
walk(dir);

const platform = (test) => {
  const bundle = files.find((f) => test(basename(f)));
  if (!bundle) return null;
  const sig = files.find((f) => f === `${bundle}.sig`);
  if (!sig) throw new Error(`${basename(bundle)} has no .sig beside it; was TAURI_SIGNING_PRIVATE_KEY set?`);
  return { signature: readFileSync(sig, "utf8").trim(), url: `${base}/${encodeURIComponent(basename(bundle))}` };
};

const platforms = {};
const linux = platform((n) => n.endsWith(".AppImage"));
const windows = platform((n) => n.endsWith("-setup.exe"));
if (linux) platforms["linux-x86_64"] = linux;
if (windows) platforms["windows-x86_64"] = windows;
if (Object.keys(platforms).length === 0) throw new Error(`no AppImage or setup.exe under ${dir}`);

const notes = notesFile ? readFileSync(notesFile, "utf8").trim() : "";
console.log(JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2));
