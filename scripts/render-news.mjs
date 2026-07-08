#!/usr/bin/env node
/**
 * Admin-managed home regions — news strip fragment generator + splicer.
 *
 * Renders a compact news strip for the legacy home page from the markdown
 * entries in site/src/content/news/ and splices the result between the
 * ADMIN:news-strip markers of a target index.html (the DIST copy at build
 * time — wired by the orchestrator, scripts/build-site.mjs).
 *
 * Selection logic:
 *   - UPCOMING mode: entries of kind "event" or "keynote" dated today or
 *     later (build time, Australia/Sydney), sorted soonest-first, each with
 *     an "Upcoming" badge.
 *   - FALLBACK mode (no upcoming items): the 3 most recent entries of any
 *     kind, newest first, badged with their kind.
 *   Every item links to the news/ page; the strip ends with an "All news"
 *   link (relative, like the legacy nav's publications/ link).
 *
 * WRAPPER CONTRACT — the fragment is ONLY the inner items markup; the
 * orchestrator owns the <section> wrapper. index.html must provide:
 *
 *   <section class="News" id="News">
 *     <div class="container">
 *       <h2 class="text-center text-uppercase text-secondary mb-0">News</h2>
 *       <br />
 *       <!-- ADMIN:news-strip:start -->
 *       (fragment is spliced here at build time by spliceNews)
 *       <!-- ADMIN:news-strip:end -->
 *     </div>
 *   </section>
 *
 * The fragment assumes: (1) it sits inside a Bootstrap 4 `.container` on the
 * legacy home (Bootstrap 4 + Montserrat/Lato already loaded — it emits only
 * `div.row > div.col-*` grid items plus a trailing centred "All news" line);
 * (2) the host page lives at the site root, so the relative links `news/`
 * and `news/#y<year>` resolve.
 *
 *   node scripts/render-news.mjs --check    -> render the fragment, verify it
 *        is non-empty well-formed HTML (balanced tags) and print it. Does NOT
 *        require index.html to contain the markers (the strip is not wired
 *        into the home page yet).
 *   node scripts/render-news.mjs <target>   -> splice into <target>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yaml = createRequire(path.join(ROOT, "site", "package.json"))("js-yaml");

const NEWS_DIR = path.join(ROOT, "site", "src", "content", "news");
const START = "<!-- ADMIN:news-strip:start -->";
const END = "<!-- ADMIN:news-strip:end -->";
const STRIP_MAX = 9; // most cards the moving home strip shows before looping

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // the legacy page encodes dashes as entities — keep byte parity with it
    .replace(/–/g, "&ndash;").replace(/—/g, "&mdash;");

/** All news entries (front matter only), recursive over ownership subfolders. */
function readEntries(dir = NEWS_DIR) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...readEntries(p));
    else if (e.name.endsWith(".md")) {
      const raw = fs.readFileSync(p, "utf8");
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) throw new Error(`no front matter: ${p}`);
      const data = yaml.load(m[1]);
      if (!data || !data.title || !data.date) throw new Error(`missing title/date: ${p}`);
      out.push({ ...data, date: isoDate(data.date), file: p });
    }
  }
  return out;
}

/** Normalise a front-matter date (Date object or string) to YYYY-MM-DD. */
const isoDate = (d) =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d).trim().slice(0, 10);

/** Today's date in Australia/Sydney as YYYY-MM-DD (en-CA gives ISO shape). */
const todaySydney = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());

/** "2026-09-01" -> "1 September 2026" (UTC-pinned: no build-machine TZ drift). */
const humanDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Pick the strip's items automatically from dates (founder decision
 *  2026-07-08: no manual curation — the admin just adds news):
 *    upcoming entries (future date) soonest-first, then the most recent past
 *    entries newest-first, capped at STRIP_MAX. */
function collectStrip() {
  const entries = readEntries();
  const today = todaySydney();
  const isFuture = (e) => e.date >= today;
  const byTitle = (a, b) => String(a.title).localeCompare(String(b.title));
  const upcoming = entries
    .filter(isFuture)
    .sort((a, b) => a.date.localeCompare(b.date) || byTitle(a, b));
  const recent = entries
    .filter((e) => !isFuture(e))
    .sort((a, b) => b.date.localeCompare(a.date) || byTitle(a, b));
  const items = [...upcoming, ...recent].slice(0, STRIP_MAX);
  return { mode: upcoming.length ? "upcoming" : "recent", items, today };
}

const badgeSpan = (text, red) =>
  `<span style="background: ${red ? "#a6192e" : "#2c3e50"}; color: #fff; font-size: 0.7rem; padding: 3px 10px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.04em">${esc(text)}</span>`;

// Uniform card: image, TYPE badge first (founder: the event type must open the
// sentence), title clamped to a fixed block, date always at the same level.
// Cards link to the entry's `link` (falling back to a legacy `source.url`) when
// present — the lab news page is reachable via the "All news" button.
// The cards live inside a moving row (.dsl-marquee) so News auto-glides just
// like Projects and Around-the-Lab; the marquee controller in index.html adds
// arrows + drag and honours prefers-reduced-motion.
export function renderNewsStrip() {
  const { mode, items, today } = collectStrip();
  const kindLabel = (k) => (k || "news").replace(/-/g, " ");
  const card = (e) => {
    // alt defaults to the title (admin never types alt); a stored alt still wins
    const img = e.cover && e.cover.image
      ? `<img class="img-fluid" src="${esc(String(e.cover.image).replace(/^\//, ""))}" alt="${esc((e.cover && e.cover.alt) || e.title)}" style="width: 100%; height: 170px; object-fit: contain; background: #fff; padding: 10px" />
              `
      : "";
    const link = e.link || (e.source && e.source.url);
    const external = Boolean(link);
    const href = external ? String(link) : `news/#y${e.date.slice(0, 4)}`;
    // red badge: the admin's custom badge wins; otherwise automatic "Upcoming"
    const red = e.badge ? String(e.badge) : e.date >= today ? "Upcoming" : "";
    const badges = badgeSpan(kindLabel(e.kind), false) + (red ? " " + badgeSpan(red, true) : "");
    return `          <div class="col-lg-4 col-md-6 mb-4">
            <a href="${esc(href)}"${external ? ' target="_blank"' : ""} style="text-decoration: none; color: inherit">
              ${img}<p class="mt-3 mb-0">${badges}</p>
              <h4 class="dsl-news-title mt-2 mb-1">${esc(e.title)}</h4>
              <p class="text-muted mb-0">${esc(humanDate(e.date))}</p>
            </a>
          </div>`;
  };
  return `        <div class="dsl-marquee" data-direction="right">
          <div class="dsl-marquee-track">
${items.map(card).join("\n")}
          </div>
        </div>
        <div class="text-center mt-2">
          <a class="btn btn-outline-secondary rounded-pill" href="news/">All news</a>
        </div>`;
}

export function spliceNews(html, fragment) {
  const i = html.indexOf(START);
  const j = html.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error("ADMIN:news-strip markers not found");
  return html.slice(0, i + START.length) + "\n" + fragment + "\n        " + html.slice(j);
}

/** Throw unless every non-void tag in the fragment is properly nested. */
function assertBalanced(html) {
  const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const stack = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>/g;
  let m;
  while ((m = re.exec(html.replace(/<!--[\s\S]*?-->/g, "")))) {
    const tag = m[1].toLowerCase();
    if (m[0].startsWith("</")) {
      const top = stack.pop();
      if (top !== tag) throw new Error(`unbalanced HTML: got </${tag}>, expected </${top ?? "(nothing open)"}>`);
    } else if (!VOID.has(tag) && !m[0].endsWith("/>")) {
      stack.push(tag);
    }
  }
  if (stack.length) throw new Error(`unbalanced HTML: unclosed <${stack.join(">, <")}>`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--check")) {
    // The home page does not carry the markers yet (orchestrator wires them),
    // so --check validates the rendered fragment itself, not a round-trip.
    const { mode, items } = collectStrip();
    const fragment = renderNewsStrip();
    try {
      if (!fragment.trim()) throw new Error("empty fragment");
      assertBalanced(fragment);
    } catch (err) {
      console.error(`FAIL: ${err.message}`);
      process.exit(1);
    }
    console.log(fragment);
    console.log(`\nnews-strip check: OK — mode=${mode}, items=${items.length}, non-empty, tags balanced`);
  } else {
    const target = process.argv[2];
    if (!target) { console.error("usage: render-news.mjs [--check | <target-index.html>]"); process.exit(1); }
    fs.writeFileSync(target, spliceNews(fs.readFileSync(target, "utf8"), renderNewsStrip()));
    console.log(`[news-strip] spliced ${target}`);
  }
}
