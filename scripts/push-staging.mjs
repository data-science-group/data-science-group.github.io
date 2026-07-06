#!/usr/bin/env node
/**
 * Publish a HISTORY-FREE snapshot of the current branch to the staging repo.
 *
 *   node scripts/push-staging.mjs [owner/repo]     # default: alishahsvnd/dsrl-site-staging
 *
 * Why a snapshot and not a branch push:
 *  - this branch's git HISTORY still contains the removed sensitive files
 *    (history purge happens with the founder's force-push, not before);
 *  - docs/ contains the security audit (exposure map) — internal only;
 *  - two legacy .wmv files exceed GitHub's 100 MB file limit.
 * So staging receives: current tree, minus docs/, minus *.wmv, one orphan commit.
 *
 * PRODUCTION (data-science-group/data-science-group.github.io) is NEVER a valid
 * target — hard-blocked below. The founder pushes production, not us.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = process.argv[2] ?? "data-science-group/dsrl-site-staging";

// Production is founder-push-only, forever. Defence in depth:
// 1. strict owner/repo charset — no shell metacharacters can survive;
// 2. exact block of the production repo;
// 3. the repo name must contain "staging";
// 4. git runs via execFileSync arg arrays — no shell interpolation at all.
const PRODUCTION = "data-science-group/data-science-group.github.io";
const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(TARGET);
if (!m || TARGET.toLowerCase() === PRODUCTION || !/staging/i.test(m[2])) {
  console.error(`FATAL: refusing target "${TARGET}" — must be a strict owner/repo whose repo name contains "staging"; production pushes are founder-only.`);
  process.exit(1);
}

const EXCLUDE_TOP = new Set([".git", "docs", "node_modules", ".playwright-mcp", "overhaul-prompt.md"]);
const EXCLUDE_RE = [/\.wmv$/i, /[\\/]node_modules([\\/]|$)/, /[\\/]dist([\\/]|$)/, /[\\/]\.astro([\\/]|$)/];

const tmp = mkdtempSync(path.join(os.tmpdir(), "dsrl-staging-"));
console.log(`[staging] snapshot -> ${tmp}`);
cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    if (!rel) return true;
    const top = rel.split(path.sep)[0];
    if (EXCLUDE_TOP.has(top)) return false;
    return !EXCLUDE_RE.some((re) => re.test(rel));
  },
});

writeFileSync(
  path.join(tmp, "README.md"),
  [
    "# STAGING — Data Science Research Lab site overhaul",
    "",
    "This is a **staging preview**, not the live site. The live site is",
    "<https://data-science-group.github.io/>. Content here may be incomplete,",
    "under review, or ahead of production. Search engines are excluded",
    "(robots noindex).",
    "",
    "Snapshot published from the local overhaul branch; history-free by design.",
    "",
  ].join("\n"),
);

const git = (...args) => execFileSync("git", args, { cwd: tmp, stdio: "inherit" });
git("init", "-b", "master");
git("add", "-A");
git("commit", "-q", "-m", "Staging snapshot of overhaul branch (history-free)");
git("remote", "add", "staging", `https://github.com/${TARGET}.git`);
git("push", "-f", "staging", "master");
rmSync(tmp, { recursive: true, force: true });
console.log(`[staging] pushed snapshot to ${TARGET}; temp cleaned.`);
