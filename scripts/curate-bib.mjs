#!/usr/bin/env node
/**
 * DBLP -> curated publications data (locked decision D3 + consultant rules).
 *
 * Reads site/src/data/dblp-raw.bib, applies the curation rules, writes:
 *   site/src/data/publications.json          (kept entries, render-ready)
 *   docs/audit/publications-curation-report.md (full audit: nothing silent)
 *
 * Run: node scripts/curate-bib.mjs
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
const OUT = path.join(ROOT, "site", "src", "data", "publications.json");
const REPORT = path.join(ROOT, "docs", "audit", "publications-curation-report.md");

const src = fs.readFileSync(RAW, "utf8");
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
for (const e of kept) {
  const title = e.fields.title || "";
  if (REVIEW_TITLE.test(title)) review.push({ key: e.key, title, reason: "title-keyword" });
  const authors = e.fields.author || [];
  if (!authors.some((a) => /beheshti/i.test(a.lastName || ""))) {
    review.push({ key: e.key, title, reason: "no-beheshti-author-match" });
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
  authors: (e.fields.author || []).map((a) => ({
    given: a.firstName || "",
    family: a.lastName || "",
    lab: /beheshti/i.test(a.lastName || ""),
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
  `Generated by scripts/curate-bib.mjs. Source: DBLP pid 90/10041 export (${parsed.entries.length} records).`,
  "Nothing is silently dropped — every exclusion is listed with its reason.",
  "",
  `- input: ${parsed.entries.length}`,
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
console.log(`kept ${out.length}/${parsed.entries.length}; dropped ${dropped.length}; review ${review.length}`);
console.log(`report -> ${path.relative(ROOT, REPORT)}`);
