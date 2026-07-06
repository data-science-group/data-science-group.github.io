#!/usr/bin/env node
/**
 * Content ownership guard (governance design, 10-rule logic).
 *
 * Decides whether a PR author may change a set of files, based on
 * .github/content-owners.yml from the BASE branch (never the PR's own copy).
 *
 * CI usage (see .github/workflows/content-guard.yml):
 *   node scripts/content-guard.mjs --author <login> --files <file-list.json>
 * where file-list.json is the GitHub PR files API response (array of
 * { filename, previous_filename? }).
 *
 * Local test usage:
 *   node scripts/content-guard.mjs --author someone --paths "a.txt,b.txt"
 *
 * Exit 0 = allowed; exit 1 = blocked (reasons printed).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yaml = createRequire(path.join(ROOT, "site", "package.json"))("js-yaml");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

const author = (arg("author") || "").toLowerCase();
if (!author) { console.error("FATAL: --author required"); process.exit(1); }

let files = [];
if (arg("files")) {
  const api = JSON.parse(fs.readFileSync(arg("files"), "utf8"));
  for (const f of api) {
    files.push(f.filename);
    if (f.previous_filename) files.push(f.previous_filename); // renames: both sides
  }
} else if (arg("paths")) {
  files = arg("paths").split(",").map((s) => s.trim()).filter(Boolean);
} else {
  console.error("FATAL: --files <json> or --paths <csv> required");
  process.exit(1);
}

const ownersFile = arg("owners") || path.join(ROOT, ".github", "content-owners.yml");
const cfg = yaml.load(fs.readFileSync(ownersFile, "utf8"));

/** glob -> regex: ** = any depth, * = within one segment. Anchored. */
const globRe = (g) =>
  new RegExp(
    "^" +
      g
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\x00")
        .replace(/\*/g, "[^/]*")
        .replace(/\x00/g, ".*") +
      "$",
  );

const matches = (file, globs) => globs.some((g) => globRe(g).test(file.replace(/\\/g, "/")));

const admins = (cfg.admins || []).map((a) => String(a).toLowerCase());
const isAdmin = admins.includes(author);

const problems = [];

if (!isAdmin) {
  // rule: protected paths are admin-only
  for (const f of files) {
    if (matches(f, cfg.protected_paths || [])) {
      problems.push(`protected path (admin-only): ${f}`);
    }
  }
  // rule: authority/config files by non-admins always fail (belt & braces —
  // they are also in protected_paths)
  for (const f of files) {
    if (/content-owners\.yml$|CODEOWNERS$|\.github\/workflows\//.test(f)) {
      problems.push(`governance file (admin-only): ${f}`);
    }
  }
  // rule: remaining files must fall inside the union of the author's sections
  const allowed = [];
  for (const [name, sec] of Object.entries(cfg.sections || {})) {
    if ((sec.owners || []).map((o) => String(o).toLowerCase()).includes(author)) {
      allowed.push(...(sec.paths || []));
    }
  }
  for (const f of files) {
    if (matches(f, cfg.protected_paths || [])) continue; // already reported
    if (!matches(f, allowed)) {
      problems.push(`outside ${author}'s sections: ${f}`);
    }
  }
}

const sectionsOf = (login) =>
  Object.entries(cfg.sections || {})
    .filter(([, s]) => (s.owners || []).map((o) => String(o).toLowerCase()).includes(login))
    .map(([n]) => n);

if (problems.length) {
  console.error(`Content ownership guard: BLOCKED for @${author}`);
  console.error(`author's sections: ${sectionsOf(author).join(", ") || "(none assigned)"}`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("Ask the site admin to assign the section in .github/content-owners.yml, or move the change into your section.");
  process.exit(1);
}
console.log(`Content ownership guard: OK for @${author}${isAdmin ? " (admin)" : ""} — ${files.length} file(s)`);
