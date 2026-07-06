#!/usr/bin/env node
/**
 * Admin-managed home regions — fragment generator + splicer (W6 step 1).
 *
 * Renders the Around-the-Lab cards from site/src/data/around-cards.yml into
 * the exact markup the legacy home uses, and splices the result between the
 * ADMIN:around-cards markers of a target index.html (the DIST copy at build
 * time — the source file keeps its current content as the visible fallback
 * and single source of truth for markup shape).
 *
 *   node scripts/render-around-cards.mjs --check   -> verify the generated
 *        fragment matches the source file's in-marker content (round-trip
 *        fidelity proof; whitespace-normalized)
 *   node scripts/render-around-cards.mjs <target>  -> splice into <target>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yaml = createRequire(path.join(ROOT, "site", "package.json"))("js-yaml");

const START = "<!-- ADMIN:around-cards:start -->";
const END = "<!-- ADMIN:around-cards:end -->";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // the legacy page encodes dashes as entities — keep byte parity with it
    .replace(/–/g, "&ndash;").replace(/—/g, "&mdash;");

export function renderCards() {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, "site", "src", "data", "around-cards.yml"), "utf8"));
  const cards = (doc.cards || []).filter((c) => c.visible !== false);
  const h4 = (c) =>
    c.badge
      ? `<h4 class="mt-3 mb-1">${esc(c.title)}
                <span style="background: #a6192e; color: #fff; font-size: 0.55em; vertical-align: middle; padding: 3px 10px; border-radius: 10px; text-transform: uppercase">${esc(c.badge)}</span>
              </h4>`
      : `<h4 class="mt-3 mb-1">${esc(c.title)}</h4>`;
  const card = (c) => `          <div class="col-lg-4 col-md-6 mb-4">
            <a href="${esc(c.link)}"${c.external ? ' target="_blank"' : ""} style="text-decoration: none; color: inherit">
              <img class="img-fluid" src="${esc(c.image)}" alt="" style="width: 100%; height: 170px; object-fit: cover" />
              ${h4(c)}
              <p class="text-muted mb-0">${esc(c.description)}</p>
            </a>
          </div>`;
  return `        <div class="dsl-marquee">
          <div class="dsl-marquee-track">
${cards.map(card).join("\n")}
          </div>
        </div>`;
}

export function splice(html, fragment) {
  const i = html.indexOf(START);
  const j = html.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error("ADMIN:around-cards markers not found");
  return html.slice(0, i + START.length) + "\n" + fragment + "\n        " + html.slice(j);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fragment = renderCards();
  if (process.argv.includes("--check")) {
    const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const i = src.indexOf(START);
    const j = src.indexOf(END);
    if (i < 0 || j < 0) {
      console.error("FAIL: markers missing in source index.html");
      process.exit(1);
    }
    const current = src.slice(i + START.length, j);
    const normal = (s) => s.replace(/\s+/g, " ").trim();
    if (normal(current) === normal(fragment)) {
      console.log("round-trip fidelity: OK (generated fragment == source content)");
    } else {
      console.error("FAIL: generated fragment differs from source in-marker content");
      const a = normal(current), b = normal(fragment);
      for (let k = 0; k < Math.min(a.length, b.length); k++) {
        if (a[k] !== b[k]) {
          console.error(`first divergence at ${k}:\n  src: …${a.slice(Math.max(0, k - 40), k + 40)}…\n  gen: …${b.slice(Math.max(0, k - 40), k + 40)}…`);
          break;
        }
      }
      process.exit(1);
    }
  } else {
    const target = process.argv[2];
    if (!target) { console.error("usage: render-around-cards.mjs [--check | <target-index.html>]"); process.exit(1); }
    fs.writeFileSync(target, splice(fs.readFileSync(target, "utf8"), fragment));
    console.log(`[around-cards] spliced ${target}`);
  }
}
