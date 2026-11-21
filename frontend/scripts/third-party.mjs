// The open-source components the website ships, for About › Licenses:
// every npm package in the frontend build and every composer package the
// backend runs on. Development-only packages are left out.
//
//   node scripts/third-party.mjs        (from frontend/; runs before `npm run build`)
//
// Reads the two lock files and writes src/generated/third-party.json. When
// backend/composer.lock is not there (the web image builds frontend/ alone)
// the file already committed is kept as it is.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = join(dirname(fileURLToPath(import.meta.url)), "..");
const composerLock = join(frontend, "../backend/composer.lock");
const out = join(frontend, "src/generated/third-party.json");

if (!existsSync(composerLock)) {
  if (existsSync(out)) {
    console.warn(`third-party: no ${composerLock}; keeping ${out}`);
    process.exit(0);
  }
  throw new Error(`third-party: ${composerLock} is missing`);
}

function npm() {
  const lock = JSON.parse(readFileSync(join(frontend, "package-lock.json"), "utf8"));
  const found = new Map();
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (path === "" || pkg.dev || pkg.link) continue;
    const name = pkg.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    found.set(`${name}@${pkg.version}`, {
      name,
      version: pkg.version,
      license: pkg.license ?? "unknown",
      url: `https://www.npmjs.com/package/${name}`,
    });
  }
  return [...found.values()];
}

function composer() {
  const lock = JSON.parse(readFileSync(composerLock, "utf8"));
  return lock.packages.map((p) => ({
    name: p.name,
    version: p.version.replace(/^v/, ""),
    license: (p.license ?? []).join(" OR ") || "unknown",
    url: (p.source?.url ?? p.homepage ?? `https://packagist.org/packages/${p.name}`).replace(/\.git$/, ""),
  }));
}

const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
const lists = { npm: npm().sort(byName), composer: composer().sort(byName) };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(lists, null, 1) + "\n");
console.log(`third-party: ${lists.npm.length} npm and ${lists.composer.length} composer packages, written to ${out}`);
