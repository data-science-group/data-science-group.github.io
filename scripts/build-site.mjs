#!/usr/bin/env node
/**
 * Full site build: Astro build + copy legacy archives into dist so every
 * pre-existing URL keeps working.
 *
 *   node scripts/build-site.mjs          # lite: skips heavy photo/media dirs (fast checks)
 *   node scripts/build-site.mjs --full   # everything (pre-deploy verification)
 *
 * The GitHub Actions deploy workflow runs the --full variant.
 */
import { cp, mkdir, stat, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCards, splice } from "./render-around-cards.mjs";
import { renderPeople, renderAlumni, splicePeople, spliceAlumni } from "./render-people.mjs";
import { renderNewsStrip, spliceNews } from "./render-news.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const DIST = path.join(SITE, "dist");
const FULL = process.argv.includes("--full");

// Legacy content that must remain served at its existing URL.
const LEGACY_DIRS = [
  "AIPA_workshop",
  "AIPLE_Workshop",
  "BigDataSociety",
  "BioFM",
  "Conference_Journal_files",
  "people",
  "projects",
  "img",
  "css",
  "js",
  "vendor",
];
// Heavy media subtrees skipped in lite mode (photo archives, raw videos).
const HEAVY = [
  /BigDataSociety[\\/]+Hackathon[\\/][^\\/]+[\\/]photos/i,
  /AIPA_workshop[\\/]2024[\\/]Photos/i,
  /projects[\\/](p2vec|iStory)[\\/].*\.wmv$/i,
];
// Files the NEW site now generates at legacy URLs — the overlay must never
// overwrite these (Astro owns them; the legacy original is superseded).
const ASTRO_OWNED = new Set([]); // add "dir/file.html" when an Astro page takes over a legacy URL
const LEGACY_FILES = [
  "index.html", // founder decision 2026-07-05: the legacy main page IS the home page
  "Conference_Journal.htm",
  "weekly-report.html",
  "weekly-report.doc",
  "weekly_presentations.html",
  "overleaf.html",
  "PhD-Advice.pdf",
  "PhdProposalMQ.pdf",
  "MQ_Assessment_Form.docx",
  "presentation_template.pptx",
];

console.log(`[build-site] astro build (${FULL ? "full" : "lite"})`);
execSync("npm run build", { cwd: SITE, stdio: "inherit" });

const filter = (src) => {
  const rel = path.relative(ROOT, src).replace(/\\/g, "/");
  if (ASTRO_OWNED.has(rel)) return false;
  return FULL || !HEAVY.some((re) => re.test(src));
};

for (const dir of LEGACY_DIRS) {
  const from = path.join(ROOT, dir);
  try {
    await stat(from);
  } catch {
    console.warn(`[build-site] missing legacy dir: ${dir}`);
    continue;
  }
  await cp(from, path.join(DIST, dir), { recursive: true, filter });
  console.log(`[build-site] copied ${dir}`);
}
await mkdir(DIST, { recursive: true });
for (const f of LEGACY_FILES) {
  try {
    await cp(path.join(ROOT, f), path.join(DIST, f));
  } catch {
    console.warn(`[build-site] missing legacy file: ${f}`);
  }
}

// Admin-managed home regions: the deployed home is rendered from data.
// Around-the-Lab cards come from site/src/data/around-cards.yml (W6 step 1).
{
  const home = path.join(DIST, "index.html");
  await writeFile(home, splice(await readFile(home, "utf8"), renderCards()));
  console.log("[build-site] admin regions spliced into home (around-cards)");
}

// People cards come from site/src/data/people.yml, the Past Members list from
// site/src/data/alumni.yml (W6 step 2).
{
  const home = path.join(DIST, "index.html");
  await writeFile(home, splicePeople(await readFile(home, "utf8"), renderPeople()));
  console.log("[build-site] admin regions spliced into home (people)");
}
{
  const home = path.join(DIST, "index.html");
  await writeFile(home, spliceAlumni(await readFile(home, "utf8"), renderAlumni()));
  console.log("[build-site] admin regions spliced into home (alumni)");
}

// News strip: upcoming events/keynotes from the news collection, computed at
// build time (the weekly scheduled rebuild keeps "upcoming" honest).
{
  const home = path.join(DIST, "index.html");
  await writeFile(home, spliceNews(await readFile(home, "utf8"), renderNewsStrip()));
  console.log("[build-site] admin regions spliced into home (news-strip)");
}

// Staging builds must never be indexed. robots.txt alone is NOT enough when
// staging is a project site under the production domain (crawlers only read
// the domain root's robots.txt), so also inject a noindex meta tag into every
// copied legacy HTML page. Astro pages already carry it via Base.astro.
if (process.env.STAGING === "1") {
  const { writeFile, readFile, readdir } = await import("node:fs/promises");
  await writeFile(path.join(DIST, "robots.txt"), "User-agent: *\nDisallow: /\n");

  const walk = async (dir) => {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)));
      else if (/\.html?$/i.test(e.name)) out.push(p);
    }
    return out;
  };
  let injected = 0;
  for (const f of await walk(DIST)) {
    const html = await readFile(f, "utf8");
    if (/name=["']robots["']/i.test(html)) continue;
    const m = html.match(/<head[^>]*>/i);
    if (!m) {
      console.warn(`[build-site] staging: no <head> in ${path.relative(DIST, f)} — noindex NOT injected`);
      continue;
    }
    const idx = m.index + m[0].length;
    await writeFile(f, html.slice(0, idx) + '\n<meta name="robots" content="noindex, nofollow" />' + html.slice(idx));
    injected++;
  }
  console.log(`[build-site] staging: robots Disallow + noindex injected into ${injected} legacy pages`);
}
console.log(`[build-site] done -> ${DIST}`);
