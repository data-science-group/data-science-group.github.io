#!/usr/bin/env node
/**
 * DBLP -> curated publications data (locked decision D3 + consultant rules).
 *
 * Fetches the DBLP BibTeX feed of each of the lab's six academic members
 * (sequentially, with a delay — be polite to DBLP), merges the feeds and
 * de-duplicates co-authored papers by DBLP citation key, applies the curation
 * rules, and writes:
 *   site/src/data/dblp-raw.bib                   (merged, key-deduped raw source)
 *   site/src/data/dblp-fetch-meta.json           (per-member fetch + dedupe stats)
 *   site/src/data/publications.json              (kept entries, render-ready)
 *   docs/audit/publications-curation-report.md   (full audit: nothing silent)
 *
 * Run: node scripts/curate-bib.mjs             (fetch from DBLP, then curate)
 *      node scripts/curate-bib.mjs --offline   (re-curate the last fetched raw)
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The parser is a dependency of site/ — import its ESM build directly
// (require.resolve would hand back the CJS build, which breaks under ESM).
const { parse } = await import(
  pathToFileURL(path.join(ROOT, "site", "node_modules", "@retorquere", "bibtex-parser", "dist", "esm", "index.js"))
);
const RAW = path.join(ROOT, "site", "src", "data", "dblp-raw.bib");
const META = path.join(ROOT, "site", "src", "data", "dblp-fetch-meta.json");
const OUT = path.join(ROOT, "site", "src", "data", "publications.json");
const REPORT = path.join(ROOT, "docs", "audit", "publications-curation-report.md");

// ---- lab members: identity-verified DBLP author records ---------------------
// Verified 6 Jul 2026 via the DBLP author search API + person records
// (https://dblp.org/pid/<pid>.xml). Evidence strings are recorded verbatim in
// the audit report — never add a pid here without affiliation evidence.
const MEMBERS = [
  {
    name: "Amin Beheshti", dblpName: "Amin Beheshti", pid: "90/10041",
    evidence: 'DBLP affiliation note "Macquarie University, Sydney, NSW, Australia"; person record links data-science-group.github.io/people/aminbeheshti/ and ORCID 0000-0002-5988-5494',
  },
  {
    name: "Xuyun Zhang", dblpName: "Xuyun Zhang", pid: "54/8558",
    evidence: "sole DBLP author of this name; ORCID 0000-0001-7353-4159 on the DBLP person record matches researchers.mq.edu.au/en/persons/xuyun-zhang",
  },
  {
    name: "Jian Yang", dblpName: "Jian Yang 0001", pid: "y/JianYang1",
    evidence: 'disambiguated homonym "Jian Yang 0001"; DBLP affiliation note "Macquarie University, Sydney, Australia" (former: Tilburg University); homepage www.ics.mq.edu.au/~jian',
  },
  {
    name: "Jia Wu", dblpName: "Jia Wu 0001", pid: "25/5536-1",
    evidence: 'disambiguated homonym "Jia Wu 0001"; DBLP affiliation note "Macquarie University, Sydney, Australia" (former: UTS; China University of Geosciences)',
  },
  {
    name: "Emma Xue", dblpName: "Shan Xue 0001", pid: "88/10188-1",
    evidence: 'publishes as "Shan Xue"; DBLP affiliation note "Macquarie University, Sydney, NSW, Australia"; person record links researchers.mq.edu.au/en/persons/emma-xue; ORCID 0000-0002-9123-5133 matches that MQ profile',
  },
  {
    name: "Yuankai Qi", dblpName: "Yuankai Qi", pid: "136/5491",
    evidence: "sole DBLP author of this name; ORCID 0000-0003-4312-5682 on the DBLP person record matches researchers.mq.edu.au/en/persons/yuankai-qi",
  },
];

// ---- fetch + merge (dedupe by DBLP citation key) ----------------------------
const OFFLINE = process.argv.includes("--offline");
const FEED_DELAY_MS = 1500; // polite to DBLP: sequential fetches, spaced out
const UA = "DSRL-site-publications-curation/1.0 (+https://data-science-group.github.io)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyOf = (block) => block.match(/^@\w+\{([^,]+),/)?.[1];

let src, meta;
if (OFFLINE) {
  src = fs.readFileSync(RAW, "utf8");
  meta = JSON.parse(fs.readFileSync(META, "utf8"));
} else {
  const merged = new Map(); // DBLP citation key -> raw block (first feed wins)
  const stats = [];
  for (const [i, m] of MEMBERS.entries()) {
    if (i > 0) await sleep(FEED_DELAY_MS);
    const url = `https://dblp.org/pid/${m.pid}.bib`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`DBLP fetch failed: HTTP ${res.status} for ${url}`);
    const text = await res.text();
    const blocks = text.split(/\n(?=@)/).map((b) => b.trim()).filter((b) => /^@\w+\{/.test(b) && keyOf(b));
    let dup = 0;
    for (const b of blocks) {
      const k = keyOf(b);
      if (merged.has(k)) dup += 1;
      else merged.set(k, b);
    }
    stats.push({ ...m, fetched: blocks.length, firstSeen: blocks.length - dup, crossFeedDuplicates: dup });
    console.log(`fetched ${m.name} (pid ${m.pid}): ${blocks.length} entries, ${blocks.length - dup} new, ${dup} already merged`);
  }
  src = [...merged.values()].join("\n\n") + "\n";
  meta = {
    fetchedAt: new Date().toISOString(),
    members: stats,
    fetchedTotal: stats.reduce((n, s) => n + s.fetched, 0),
    crossFeedDuplicates: stats.reduce((n, s) => n + s.crossFeedDuplicates, 0),
    mergedUnique: merged.size,
  };
  fs.writeFileSync(RAW, src);
  fs.writeFileSync(META, JSON.stringify(meta, null, 2));
}
const parsed = parse(src);

// Raw BibTeX block per key (for the <details> BibTeX display), with DBLP
// bookkeeping fields stripped to keep page weight down.
const rawBlocks = {};
for (const chunk of src.split(/\n(?=@)/)) {
  const m = chunk.match(/^@\w+\{([^,]+),/);
  if (m) {
    rawBlocks[m[1]] = chunk
      .replace(/^\s*(timestamp|biburl|bibsource)\s*=\s*\{[^}]*\},?\s*$/gim, "")
      .replace(/\n{2,}/g, "\n")
      .replace(/^[ \t]{2,}/gm, "  ")
      .trim();
  }
}

const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const REVIEW_TITLE = /(editorial|foreword|keynote|tutorial|panel|poster|demo\b|extended abstract|corrigend|errat|invited talk)/i;

const kept = [];
const dropped = [];
const review = [];

// index for duplicate detection
const byTitle = new Map();
const byDoi = new Map();
for (const e of parsed.entries) {
  const t = norm(e.fields.title);
  if (t) (byTitle.get(t) ?? byTitle.set(t, []).get(t)).push(e);
  const d = (e.fields.doi || "").toLowerCase();
  if (d) (byDoi.get(d) ?? byDoi.set(d, []).get(d)).push(e);
}

const isInformal = (e) =>
  (e.fields.journal || "").trim() === "CoRR" ||
  /computing research repository/i.test(e.fields.journal || "");

function venueType(e) {
  if (e.type === "article") return isInformal(e) ? "Other" : "Journal";
  if (e.type === "inproceedings") {
    const bt = e.fields.booktitle || "";
    return /workshop|w@|@|co-located|colocated/i.test(bt) ? "Workshop" : "Conference";
  }
  if (e.type === "book" || e.type === "incollection") return "Book/Chapter";
  if (e.type === "phdthesis" || e.type === "mastersthesis") return "Thesis";
  return "Other";
}

function richness(e) {
  let r = 0;
  if (!isInformal(e)) r += 4;
  if (e.fields.pages) r += 2;
  if (e.fields.volume || e.fields.number) r += 1;
  return r;
}

const seenDrop = new Set();
for (const e of parsed.entries) {
  const key = e.key;
  const title = e.fields.title || "(untitled)";
  // rule: editorships out
  if (e.type === "proceedings") {
    dropped.push({ key, title, reason: "proceedings-editorship" });
    seenDrop.add(key);
    continue;
  }
  // rule: informal dupe of a published record (same normalized title, non-informal exists)
  if (isInformal(e)) {
    const twins = (byTitle.get(norm(title)) || []).filter((x) => x.key !== key && !isInformal(x));
    if (twins.length) {
      dropped.push({ key, title, reason: `preprint-duplicate-of:${twins[0].key}` });
      seenDrop.add(key);
      continue;
    }
  }
  // rule: exact DOI duplicates — keep the richest
  const doi = (e.fields.doi || "").toLowerCase();
  if (doi && byDoi.get(doi).length > 1) {
    const group = byDoi.get(doi);
    const best = [...group].sort((a, b) => richness(b) - richness(a))[0];
    if (best.key !== key) {
      dropped.push({ key, title, reason: `doi-duplicate-of:${best.key}` });
      seenDrop.add(key);
      continue;
    }
  }
  kept.push(e);
}

// human-review flags (kept, but logged)
// DBLP .bib feeds print canonical names without the numeric homonym suffix,
// so match members on "given family" with the suffix stripped.
const MEMBER_NAMES = new Set(MEMBERS.map((m) => m.dblpName.replace(/ \d{4}$/, "").toLowerCase()));
for (const e of kept) {
  const title = e.fields.title || "";
  if (REVIEW_TITLE.test(title)) review.push({ key: e.key, title, reason: "title-keyword" });
  const authors = e.fields.author || [];
  if (!authors.some((a) => MEMBER_NAMES.has(`${a.firstName || ""} ${a.lastName || ""}`.trim().toLowerCase()))) {
    review.push({ key: e.key, title, reason: "no-member-author-match" });
  }
  // title-similar cross-venue dupes with different DOI
  const twins = (byTitle.get(norm(title)) || []).filter(
    (x) => x.key !== e.key && !seenDrop.has(x.key) && (x.fields.doi || "") !== (e.fields.doi || ""),
  );
  if (twins.length) review.push({ key: e.key, title, reason: `title-similar-to:${twins.map((t) => t.key).join("+")}` });
}

// Raw-fidelity field extraction: DBLP's exact casing, braces stripped.
// (The parser sentence-cases unprotected words — verifier finding.)
function rawField(key, name) {
  const block = rawBlocks[key] || "";
  const m = block.match(new RegExp(name + "\\s*=\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}", "is"));
  return m ? m[1].replace(/\s*\n\s*/g, " ").replace(/[{}]/g, "").trim() : null;
}

const out = kept.map((e) => ({
  key: e.key,
  type: venueType(e),
  title: rawField(e.key, "title") || e.fields.title || "(untitled)",
  // No per-author flags: founder rule — no name is highlighted on the page,
  // every author renders identically.
  authors: (e.fields.author || []).map((a) => ({
    given: a.firstName || "",
    family: a.lastName || "",
  })),
  venue: rawField(e.key, "journal") || rawField(e.key, "booktitle") || rawField(e.key, "publisher") || (e.type === "phdthesis" ? "PhD thesis" : ""),
  volume: e.fields.volume || null,
  number: e.fields.number || null,
  pages: e.fields.pages || null,
  year: parseInt(e.fields.year, 10) || 0,
  doi: e.fields.doi || null,
  url: e.fields.url || null,
  bibtex: rawBlocks[e.key] || null,
  selected: false, // founder-curated later (admin panel field)
}));
out.sort((a, b) => b.year - a.year ||
  ["Journal", "Conference", "Workshop", "Book/Chapter", "Thesis", "Other"].indexOf(a.type) -
  ["Journal", "Conference", "Workshop", "Book/Chapter", "Thesis", "Other"].indexOf(b.type) ||
  a.title.localeCompare(b.title));

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

// ---- report ----------------------------------------------------------------
const typeCounts = {};
for (const e of parsed.entries) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
const dropReasons = {};
for (const d of dropped) dropReasons[d.reason.split(":")[0]] = (dropReasons[d.reason.split(":")[0]] || 0) + 1;
const yearType = {};
for (const o of out) {
  yearType[o.year] = yearType[o.year] || {};
  yearType[o.year][o.type] = (yearType[o.year][o.type] || 0) + 1;
}
const missing = {
  doi: out.filter((o) => !o.doi).length,
  url: out.filter((o) => !o.url).length,
  venue: out.filter((o) => !o.venue).length,
  pages: out.filter((o) => !o.pages).length,
};
const lines = [
  "# Publications curation report",
  "",
  `Generated by scripts/curate-bib.mjs. Sources: DBLP author records of the lab's six academic members, fetched ${meta.fetchedAt}.`,
  "Nothing is silently dropped — every exclusion is listed with its reason.",
  "",
  "## Sources (identity-verified DBLP author records)",
  "",
  ...meta.members.map((m) =>
    `- ${m.name} — DBLP pid ${m.pid}${m.dblpName !== m.name ? ` (listed as "${m.dblpName}")` : ""} — fetched ${m.fetched}, first-seen ${m.firstSeen}, cross-feed duplicates ${m.crossFeedDuplicates}. Identity evidence: ${m.evidence}.`),
  "",
  "## Merge + curation summary",
  "",
  `- fetched total: ${meta.fetchedTotal} across ${meta.members.length} feeds`,
  `- cross-feed duplicates removed (same DBLP citation key — co-authored papers listed once): ${meta.crossFeedDuplicates}`,
  `- merged input: ${parsed.entries.length}`,
  `- by BibTeX type: ${JSON.stringify(typeCounts)}`,
  `- kept: ${out.length}`,
  `- auto-excluded: ${dropped.length} — by reason: ${JSON.stringify(dropReasons)}`,
  `- human-review flags (kept but check): ${review.length}`,
  `- selected publications: ${out.filter((o) => o.selected).length} (founder curates via admin)`,
  `- missing fields: ${JSON.stringify(missing)}`,
  "",
  "## Output by year/type",
  ...Object.keys(yearType).sort((a, b) => b - a).map((y) => `- ${y}: ${JSON.stringify(yearType[y])}`),
  "",
  "## Auto-excluded records",
  ...dropped.map((d) => `- [${d.reason}] ${d.key} — ${d.title}`),
  "",
  "## Human-review queue",
  ...review.map((r) => `- [${r.reason}] ${r.key} — ${r.title}`),
  "",
];
fs.writeFileSync(REPORT, lines.join("\n"));
console.log(`merged ${parsed.entries.length} unique records from ${meta.fetchedTotal} fetched (${meta.crossFeedDuplicates} cross-feed duplicates removed)`);
console.log(`kept ${out.length}/${parsed.entries.length}; dropped ${dropped.length}; review ${review.length}`);
console.log(`report -> ${path.relative(ROOT, REPORT)}`);
