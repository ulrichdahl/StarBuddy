// Fails the build when the help has fallen behind the app:
//  - a page in src/App.tsx with no help topic for it (src/help/topics.json › routes);
//  - a topic without its text in every language, or without a `# Title` line;
//  - a link to a topic that does not exist;
//  - a screenshot the text shows that is not in public/help/screens/<lang>/.
// Screenshots nothing shows any more are listed as a warning.
//
//   node scripts/help-check.mjs        (from frontend/; runs before `npm run build`)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = join(dirname(fileURLToPath(import.meta.url)), "..");
const LANGS = ["en", "da"];
const { topics, routes } = JSON.parse(readFileSync(join(frontend, "src/help/topics.json"), "utf8"));
const ids = new Set(topics.map((t) => t.id));
const problems = [];

// Every page has a topic.
const app = readFileSync(join(frontend, "src/App.tsx"), "utf8");
const paths = [...app.matchAll(/<Route\s+(?:index\b|path="([^"]+)")/g)].map((m) => m[1] ?? "/").filter((p) => p !== "*");
for (const path of paths) {
  if (!routes[path]) problems.push(`page ${path} has no help topic in src/help/topics.json › routes`);
}
for (const [path, id] of Object.entries(routes)) {
  if (!ids.has(id)) problems.push(`route ${path} points at unknown topic "${id}"`);
}

// Every topic in every language, with its links and screenshots.
const used = Object.fromEntries(LANGS.map((l) => [l, new Set()]));
for (const lang of LANGS) {
  for (const { id } of topics) {
    const file = join(frontend, "src/help/content", lang, `${id}.md`);
    if (!existsSync(file)) {
      problems.push(`${lang}/${id}.md is missing`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    if (!/^# \S/.test(text)) problems.push(`${lang}/${id}.md does not start with "# Title"`);
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|\/)/.test(target)) continue;
      if (target.startsWith("screens/")) {
        const name = target.slice("screens/".length);
        used[lang].add(name);
        if (!existsSync(join(frontend, "public/help/screens", lang, name))) problems.push(`${lang}/${id}.md shows ${target}, which is not in public/help/screens/${lang}/`);
      } else if (!ids.has(target.split("#")[0])) {
        problems.push(`${lang}/${id}.md links to unknown topic "${target}"`);
      }
    }
  }
}
for (const lang of LANGS) {
  const dir = join(frontend, "public/help/screens", lang);
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (!used[lang].has(name)) console.warn(`help-check: public/help/screens/${lang}/${name} is not shown anywhere`);
  }
}

if (problems.length) {
  console.error("help-check: the help is out of date:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`help-check: ${topics.length} topics in ${LANGS.length} languages, ${paths.length} pages covered`);
