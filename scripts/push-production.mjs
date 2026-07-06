#!/usr/bin/env node
/**
 * PRODUCTION cutover push — founder-triggered only.
 *
 * Publishes the current tree as ONE fresh commit (no overhaul-branch history)
 * to data-science-group/data-science-group.github.io, replacing master.
 * This IS the history purge of decision D4: the old history (sensitive files,
 * 2GB media) stops being the branch; a backup bundle is saved locally first.
 *
 *   node scripts/push-production.mjs --dry-run
 *   node scripts/push-production.mjs --confirm data-science-group.github.io [--message "Site update"]
 *
 * What it does, in order:
 *   1. snapshot the tree (same exclusions as staging: docs/, node_modules, .wmv)
 *   2. rewrite site/public/admin/config.yml: admin backend staging -> production
 *   3. back up the CURRENT production master to ../dsrl-prod-backup-<date>.bundle
 *   4. git init + single commit with your message + force-push master
 *
 * Run AFTER flipping Pages source to "GitHub Actions" (see docs/cutover-runbook.md);
 * the live site keeps serving the old deployment until the new build succeeds.
 */
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION = "data-science-group/data-science-group.github.io";
const STAGING = "data-science-group/dsrl-site-staging";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : null;
};

const DRY = flag("dry-run");
const MESSAGE = opt("message") || "Site update";

// The ceremony gate: an explicit, exact confirmation — nothing implicit.
if (!DRY && opt("confirm") !== "data-science-group.github.io") {
  console.error(
    "FATAL: this pushes PRODUCTION and replaces master history.\n" +
    "Founder ceremony required:\n" +
    '  node scripts/push-production.mjs --confirm data-science-group.github.io [--message "Site update"]\n' +
    "Or rehearse safely with: --dry-run",
  );
  process.exit(1);
}

// 1. snapshot
const EXCLUDE_TOP = new Set([".git", "docs", "node_modules", ".playwright-mcp", "overhaul-prompt.md"]);
const EXCLUDE_RE = [/\.wmv$/i, /[\\/]node_modules([\\/]|$)/, /[\\/]dist([\\/]|$)/, /[\\/]\.astro([\\/]|$)/];

const tmp = mkdtempSync(path.join(os.tmpdir(), "dsrl-production-"));
console.log(`[production] snapshot -> ${tmp}`);
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

// 2. admin panel backend: staging repo -> production repo
const cfgPath = path.join(tmp, "site", "public", "admin", "config.yml");
let cfg = readFileSync(cfgPath, "utf8");
const swaps = [
  [`repo: ${STAGING}`, `repo: ${PRODUCTION}`],
  ["site_url: https://data-science-group.github.io/dsrl-site-staging", "site_url: https://data-science-group.github.io"],
  ["display_url: https://data-science-group.github.io/dsrl-site-staging", "display_url: https://data-science-group.github.io"],
];
for (const [from, to] of swaps) {
  if (!cfg.includes(from)) {
    console.error(`FATAL: admin config swap failed — expected "${from}" in site/public/admin/config.yml`);
    process.exit(1);
  }
  cfg = cfg.replace(from, to);
}
writeFileSync(cfgPath, cfg);
console.log("[production] admin backend rewritten: staging -> production repo");

const git = (args, opts = {}) => execFileSync("git", args, { cwd: tmp, stdio: "inherit", ...opts });

// 3. backup the current production master before replacing it
const stamp = new Date().toISOString().slice(0, 10);
const bundle = path.join(ROOT, "..", `dsrl-prod-backup-${stamp}.bundle`);
git(["init", "-b", "master"]);
if (!flag("no-backup")) {
  console.log(`[production] backing up current production master -> ${bundle}`);
  git(["fetch", `https://github.com/${PRODUCTION}.git`, "master"]);
  git(["bundle", "create", bundle, "FETCH_HEAD"]);
  if (!existsSync(bundle)) {
    console.error("FATAL: backup bundle missing — refusing to continue");
    process.exit(1);
  }
}

// 4. one clean commit as the LAB account (founder rule: no personal identity
//    on production), force-push
const IDENT = [
  "-c", "user.name=data-science-group",
  "-c", "user.email=34052419+data-science-group@users.noreply.github.com",
];
git(["add", "-A"]);
git([...IDENT, "commit", "-q", "-m", MESSAGE]);
const count = execFileSync("git", ["ls-files"], { cwd: tmp }).toString().trim().split("\n").length;
console.log(`[production] single commit "${MESSAGE}" with ${count} files, no prior history`);

if (DRY) {
  rmSync(tmp, { recursive: true, force: true });
  console.log("[production] DRY RUN — nothing pushed. Rehearsal complete; temp cleaned.");
  process.exit(0);
}

git(["remote", "add", "production", `https://github.com/${PRODUCTION}.git`]);
git(["push", "-f", "production", "master"]);
rmSync(tmp, { recursive: true, force: true });
console.log(`[production] PUSHED to ${PRODUCTION}. Old history backed up at: ${bundle}`);
console.log("[production] Watch the deploy: gh run watch -R " + PRODUCTION);
