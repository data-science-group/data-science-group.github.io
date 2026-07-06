#!/usr/bin/env node
/**
 * Export the pre-diet ORIGINAL media from git history into a folder the
 * founder can push to the archive repo (decision D4), once that repo exists.
 *
 *   node scripts/export-originals.mjs [outDir]   (default: ../dsrl-media-archive-export)
 *
 * Handles every "Media diet" commit (photo compression AND the wmv retirement):
 * for each, the files it changed/removed are extracted from its PARENT, where
 * the originals still exist. First write wins (oldest state preserved).
 *
 * execFileSync with arg arrays, NEVER a shell string: on Windows execSync goes
 * through cmd.exe, which eats "^" — silently turning "<sha>^" into "<sha>" and
 * every diff into an empty one (found the hard way: "exported 0 originals").
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "..", "dsrl-media-archive-export"));

const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, ...opts });

const commits = git(["log", "--format=%H", "--grep=^Media diet"])
  .toString().trim().split("\n").filter(Boolean);
if (!commits.length) throw new Error("no media-diet commits found");

// oldest first, so the earliest (most original) version wins on conflicts
commits.reverse();

let n = 0, bytes = 0;
const written = new Set();
for (const commit of commits) {
  const base = `${commit}~1`;
  const changed = git(["diff", "--name-only", base, commit])
    .toString().trim().split("\n")
    .filter((f) => /\.(jpe?g|png|wmv)$/i.test(f));
  for (const f of changed) {
    if (written.has(f)) continue;
    let buf;
    try {
      // stderr silenced: "not in <parent>" is the expected added-by-this-commit case
      buf = git(["show", `${base}:${f}`], { maxBuffer: 1024 * 1024 * 256, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      continue; // didn't exist before this commit (e.g. the new .jpg/.mp4) — skip
    }
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    written.add(f);
    n++; bytes += buf.length;
  }
}
if (n === 0) throw new Error("exported nothing — diff/show plumbing is broken, refusing to pretend success");
console.log(`exported ${n} originals (${(bytes / 1e9).toFixed(2)} GB) -> ${OUT}`);
console.log("When the founder creates the archive repo: git init + push this folder there.");
