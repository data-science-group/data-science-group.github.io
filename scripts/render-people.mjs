#!/usr/bin/env node
/**
 * Admin-managed home regions — People + Alumni fragment generators + splicers
 * (W6 step 2; same pattern as render-around-cards.mjs).
 *
 * Renders the member cards from site/src/data/people.yml and the Past Members
 * list from site/src/data/alumni.yml into the exact markup the legacy home
 * uses, and splices the results between the ADMIN:people / ADMIN:alumni
 * markers of a target index.html (the DIST copy at build time — the source
 * file keeps the same content as the visible fallback and the round-trip
 * fidelity reference).
 *
 * The legacy page carries per-entry presentation quirks (role rendered in a
 * <span> for some cards, singular/plural "Supervisor(s)" labels that do not
 * follow the supervisor count, project-period text like "2024-2025" instead
 * of "Graduated YYYY", links embedded in thesis titles, …). Those quirks are
 * NOT data an admin should have to manage, and the YAML schemas in
 * site/src/content.config.ts have no fields for them, so they live here in
 * per-id quirk tables (option (b) of the normalization policy — see
 * docs/audit/extraction-exceptions.md '## People-region normalizations').
 *
 *   node scripts/render-people.mjs --check   -> verify BOTH generated
 *        fragments match the source file's in-marker content (round-trip
 *        fidelity proof; whitespace-normalized)
 *   node scripts/render-people.mjs <target>  -> splice both into <target>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yaml = createRequire(path.join(ROOT, "site", "package.json"))("js-yaml");

const PEOPLE_START = "<!-- ADMIN:people:start -->";
const PEOPLE_END = "<!-- ADMIN:people:end -->";
const ALUMNI_START = "<!-- ADMIN:alumni:start -->";
const ALUMNI_END = "<!-- ADMIN:alumni:end -->";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // the legacy page encodes dashes as entities — keep byte parity with it
    .replace(/–/g, "&ndash;").replace(/—/g, "&mdash;");

/* ------------------------------------------------------------------ people */

// Cards whose role renders as (<span class="auto-style1">…</span>) instead of
// the usual (<b>…</b>) — exactly as on the legacy page.
const SPAN_ROLE = new Set([
  "xuyun-zhang", "jian-yang", "jia-wu", "emma-xue", "yuankai-qi",
  "jing-du", "habiba-habiba",
]);

// img alt text on the legacy page where it does NOT equal the person's name
// minus the honorific — preserved verbatim (this generator reproduces the
// legacy page byte-for-byte at the DOM level).
const ALT_OVERRIDE = {
  "habiba-habiba": "Habiba",
  "seyedali-mohseni": "Ali Mohseni",
};

// Armin Lari's card reads (<b>MRes Y2 + PhD)</b>) on the legacy page — a
// stray ')' inside the bold. people.yml keeps the clean role; the quirk is
// reproduced here so the rendered page does not change. Founder to confirm
// the typo can be dropped.
const ROLE_SUFFIX = { "armin-lari": ")" };

const personAlt = (p) =>
  ALT_OVERRIDE[p.id] ?? p.name.replace(/^(?:A\/)?(?:Prof|Dr)\.\s+/, "");

export function renderPeople() {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, "site", "src", "data", "people.yml"), "utf8"));
  const people = (doc.people || []).filter((p) => p.visible !== false);
  const card = (p) => {
    const href = p.links && (p.links.website || p.links.linkedin);
    const open = href ? `<a target="_blank" href="${esc(href)}">` : `<a target="_blank">`;
    const role = SPAN_ROLE.has(p.id)
      ? `<span class="auto-style1">${esc(p.role)}</span>`
      : `<b>${esc(p.role)}${ROLE_SUFFIX[p.id] ?? ""}</b>`;
    return `          <div class="col-md-4 col-lg-2">
            <div class="gallery">
              ${open}
                <img src="${esc(p.photo)}" alt="${esc(personAlt(p))}" width="50" />
              </a>
              <div class="desc">
                ${esc(p.name)}<br />
                (${role})
              </div>
            </div>
          </div>`;
  };
  return `        <div class="row">
${people.map(card).join("\n\n")}
        </div>`;
}

/* ------------------------------------------------------------------ alumni */

// Per-entry presentation quirks, keyed by alumni.yml id. Everything here is
// exactly what the legacy page shows; alumni.yml stays clean data.
//   period      — text shown instead of "Graduated YYYY" (project period,
//                 bare year, or Alireza Jolfaei's free-form tail)
//   thesis_link — href wrapped around the thesis/project title on the page
//                 (no schema field exists for it; kept here so no link is
//                 dropped)
//   sup_label   — "Supervisor"/"Supervisors" where the page disagrees with
//                 the supervisor count
//   sup_join    — separator between supervisor names (default ", ")
//   label_html  — verbatim supervisor label markup (Negin: colon+&nbsp;
//                 inside the <b>)
//   associate   — first supervisor + "; Associate Supervisor: rest"
//   double_label— Ambreen (MRes): "Supervisors: Supervisor: …" doubled label
//   end         — after the supervisor list: "." (default) | "br" | ".br" | ""
//   quote_gap   — whitespace between the opening quote and the linked title
//   award_nbsp  — award label is <b>Awarded:&nbsp;</b> glued to the text
//   award_end   — stray trailing character after the award text (";")
//   empty_span  — Aaron: trailing empty red <span> on the page
const MQ_CENTRE =
  "https://www.mq.edu.au/research/research-centres-groups-and-facilities/centres/centre-for-applied-artificial-intelligence";
const ALUMNI_QUIRKS = {
  "meiyan-teng": { end: "br" },
  "junyan-li": { end: "br" },
  "adeem-ali-anwar": { end: "br", tight_after_when: true },
  "saleh-afzoon": { end: "br", award_end: ";" },
  "masoud-safilian": { end: "br", award_end: ";" },
  "maryam-shahabikargar-phd-student": { end: "br", award_end: ";" },
  "kexuan-xin": { end: ".br", sup_label: "Supervisor", sup_join: " and ", period: "2024-2025", thesis_link: MQ_CENTRE, quote_gap: true },
  "usman-shahbaz-phd-student": { end: "br" },
  "aaron-gaskell": { end: ".br", sup_label: "Supervisors", empty_span: true },
  "nasrin-shabani-phd-student": { end: ".br" },
  "majid-namazi": { end: ".br", period: "2024-2025", thesis_link: MQ_CENTRE, quote_gap: true },
  "afrooz-sheikholeslami": { sup_label: "Supervisors" },
  "mehrdad-mansouri": { end: ".br", sup_label: "Supervisors", period: "2024-2025", thesis_link: "https://www.linkedin.com/in/mehrdad-mansouri-9ab961260/", quote_gap: true },
  "jin-foo": { end: ".br" },
  "erfan-moshiri": { sup_label: "Supervisors" },
  "ambreen-hanif-phd-student": { end: ".br" },
  "nabi-rezvani": { end: ".br", sup_label: "Supervisors" },
  "fariba-lotfi": { end: ".br" },
  "mahdieh-labani": { end: ".br" },
  "helia-farhood": { end: ".br", period: "2021-2023", thesis_link: "https://researchers.mq.edu.au/en/projects/intelligent-educational-knowledge-lake", quote_gap: true, award_nbsp: true },
  "alireza-shammasi": { end: ".br" },
  "haolong-xiang": { end: ".br", award_nbsp: true },
  "francesco-schiliro": { end: ".br" },
  "matine-poushide": { end: ".br", award_nbsp: true },
  "alireza-jolfaei": { end: "", period: "Lab Member 2021-2022, Senior Lecturer." },
  "nasrin-shabani-mres-student": { associate: true },
  "ambreen-hanif-mres-student": { associate: true, double_label: true },
  "fariborz-sobnmanesh": { period: "2019-2021", thesis_link: "https://researchers.mq.edu.au/en/projects/ai-enabled-industry-challenges-and-opportunity-study" },
  "shuang-wang": { period: "2021", thesis_link: "https://researchers.mq.edu.au/en/projects/linking-cognitive-technology-and-sensory-systems-to-support-perso" },
  "samira-ghodratnama": { end: ".br" },
  "shahpar-yakhchi": { end: ".br" },
  "alireza-bordbar": { period: "2020", thesis_link: "https://arxiv.org/abs/2007.08710" },
  "mohssen-ghafari": { end: ".br", thesis_link: "https://figshare.mq.edu.au/articles/thesis/Towards_time-aware_context-aware_deep_trust_prediction_in_online_social_networks/19435601" },
  "usman-shahbaz-mres-student": { thesis_link: "https://figshare.mq.edu.au/articles/thesis/Towards_automating_the_recruitment_process/19435799" },
  "farhad-amouzgar": { sup_join: " & ", thesis_link: "https://figshare.mq.edu.au/articles/thesis/Deep_reinforcement_learning_as_text_generator_in_image_captioning/19435757" },
  "frank-schiliro": { thesis_link: "https://figshare.mq.edu.au/articles/thesis/Internet_of_things_enabled_policing_processes/19435850" },
  "vahid-moraveji": { thesis_link: "https://figshare.mq.edu.au/articles/thesis/Social_influence_and_radicalization_a_social_data_analytics_study/19432388" },
  "negin-hesam-shariati": { period: "2019", label_html: "<b>Supervisor:&nbsp;</b>" },
  "sami-ghodratnama": { period: "2019" },
};

// "Project Title" (postdocs / research fellows / research staff) vs the
// default "Thesis Title" — derivable from the degree on every legacy entry.
const titleLabel = (degree) =>
  /fellow|scientist/i.test(degree) && !/student/i.test(degree)
    ? "Project Title"
    : "Thesis Title";

export function renderAlumni() {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, "site", "src", "data", "alumni.yml"), "utf8"));
  const alumni = (doc.alumni || []).filter((a) => a.visible !== false);
  const item = (a) => {
    const q = ALUMNI_QUIRKS[a.id] || {};
    const name = a.link
      ? `<a target="_blank" href="${esc(a.link)}">${esc(a.name)}</a>`
      : `<a target="_blank">${esc(a.name)}</a>`;
    const when = q.period ? esc(q.period) : `Graduated ${a.graduated}`;
    let body = `${name}, <b>${esc(a.degree)}</b>, ${when}`;
    if (a.thesis) {
      const title = q.thesis_link
        ? `<a href="${esc(q.thesis_link)}" target="_blank">${esc(a.thesis)}</a>`
        : esc(a.thesis);
      body += `${q.tight_after_when ? "," : ", "}<b>${titleLabel(a.degree)}</b>: "${q.quote_gap ? "\n            " : ""}${title}"`;
    }
    const sups = a.supervisors || [];
    if (sups.length) {
      if (q.associate) {
        const lead = q.double_label ? "<b>Supervisors</b>: <b>Supervisor</b>" : "<b>Supervisor</b>";
        body += `, ${lead}: ${esc(sups[0])}; <b>Associate Supervisor</b>: ${esc(sups.slice(1).join(", "))}`;
      } else if (q.label_html) {
        body += `, ${q.label_html}${esc(sups.join(q.sup_join || ", "))}`;
      } else {
        const label = q.sup_label || (sups.length > 1 ? "Supervisors" : "Supervisor");
        body += `, <b>${label}</b>: ${esc(sups.join(q.sup_join || ", "))}`;
      }
    }
    const end = q.end ?? ".";
    body += end === "br" ? "<br />" : end === ".br" ? ".<br />" : end;
    if (a.award) {
      body += q.award_nbsp
        ? `\n            <span style="color: red; font-size: medium"><b>Awarded:&nbsp;</b></span>${esc(a.award)}${q.award_end || ""}`
        : `\n            <span style="color: red; font-size: medium"><b>Awarded:</b></span>\n            ${esc(a.award)}${q.award_end || ""}`;
    }
    if (q.empty_span) body += `\n            <span style="color: red; font-size: medium"></span>`;
    return `          <li>
            ${body}
          </li>`;
  };
  return `        <ol reversed>
${alumni.map(item).join("\n\n")}
        </ol>`;
}

/* ------------------------------------------------------------------ splice */

function spliceBetween(html, start, end, fragment) {
  const i = html.indexOf(start);
  const j = html.indexOf(end);
  if (i < 0 || j < 0 || j < i) throw new Error(`${start} … ${end} markers not found`);
  return html.slice(0, i + start.length) + "\n" + fragment + "\n        " + html.slice(j);
}

export const splicePeople = (html, fragment) => spliceBetween(html, PEOPLE_START, PEOPLE_END, fragment);
export const spliceAlumni = (html, fragment) => spliceBetween(html, ALUMNI_START, ALUMNI_END, fragment);

/* --------------------------------------------------------------------- cli */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const regions = [
    { label: "people", start: PEOPLE_START, end: PEOPLE_END, fragment: renderPeople() },
    { label: "alumni", start: ALUMNI_START, end: ALUMNI_END, fragment: renderAlumni() },
  ];
  if (process.argv.includes("--check")) {
    const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const normal = (s) => s.replace(/\s+/g, " ").trim();
    let failed = false;
    for (const { label, start, end, fragment } of regions) {
      const i = src.indexOf(start);
      const j = src.indexOf(end);
      if (i < 0 || j < 0) {
        console.error(`FAIL(${label}): markers missing in source index.html`);
        failed = true;
        continue;
      }
      const current = src.slice(i + start.length, j);
      if (normal(current) === normal(fragment)) {
        console.log(`round-trip fidelity (${label}): OK (generated fragment == source content)`);
      } else {
        console.error(`FAIL(${label}): generated fragment differs from source in-marker content`);
        const a = normal(current), b = normal(fragment);
        for (let k = 0; k < Math.min(a.length, b.length); k++) {
          if (a[k] !== b[k]) {
            console.error(`first divergence at ${k}:\n  src: …${a.slice(Math.max(0, k - 40), k + 40)}…\n  gen: …${b.slice(Math.max(0, k - 40), k + 40)}…`);
            break;
          }
        }
        if (a.length !== b.length && a.slice(0, Math.min(a.length, b.length)) === b.slice(0, Math.min(a.length, b.length))) {
          console.error(`lengths differ (src ${a.length} vs gen ${b.length}); shorter is a prefix of longer`);
        }
        failed = true;
      }
    }
    process.exit(failed ? 1 : 0);
  } else {
    const target = process.argv[2];
    if (!target) { console.error("usage: render-people.mjs [--check | <target-index.html>]"); process.exit(1); }
    let html = fs.readFileSync(target, "utf8");
    for (const { start, end, fragment } of regions) html = spliceBetween(html, start, end, fragment);
    fs.writeFileSync(target, html);
    console.log(`[people+alumni] spliced ${target}`);
  }
}
