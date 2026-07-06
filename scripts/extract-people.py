#!/usr/bin/env python3
"""Extract people + alumni data from the legacy index.html.

Reads:
  index.html                          (legacy Bootstrap Freelancer single page)
  docs/audit/mimecast-unwrap-map.csv  (wrapped -> canonical URL map)

Writes:
  site/src/data/people.yml
  site/src/data/alumni.yml
  docs/audit/extraction-exceptions.md

Python 3.11 stdlib only. Extraction only: data is copied verbatim from the
HTML. Anything dropped, ambiguous, or suspicious is recorded in the
exceptions report (the founder's review queue) — nothing is invented or
silently "fixed".
"""
from __future__ import annotations

import csv
import html
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
MAP_CSV = ROOT / "docs" / "audit" / "mimecast-unwrap-map.csv"
PEOPLE_OUT = ROOT / "site" / "src" / "data" / "people.yml"
ALUMNI_OUT = ROOT / "site" / "src" / "data" / "alumni.yml"
EXCEPTIONS_OUT = ROOT / "docs" / "audit" / "extraction-exceptions.md"

GEN_DATE = "2026-07-04"
YAML_HEADER = (
    f"# GENERATED from legacy index.html by scripts/extract-people.py on {GEN_DATE} "
    "— founder review pending. Do not hand-edit while migration is in progress."
)

MIMECAST_HOSTS = ("url.au.m.mimecastprotect.com", "protect-au.mimecast.com")

# Migration rule 3 (known-wrong links). Keyed by lower-cased person name.
# Applied in BOTH the People section and the Past Members list.
KNOWN_WRONG = {
    "hadi abachi": (
        "Card href is the same mimecast token as Afrooz Sheikholeslami's card "
        "(index.html lines ~883 / ~1021). Dropped per migration rule 3(a)."
    ),
    "afrooz sheikholeslami": (
        "Shares the identical mimecast token with Hadi Abachi's card. The unwrap map "
        "resolves that token to https://www.linkedin.com/in/hadi-m-abachi-99956a91/ "
        "(a profile slug matching HADI's name), so this link cannot be trusted as "
        "Afrooz's. Dropped for safety; founder to confirm the correct profile for both."
    ),
}

# Hand-noted observations that a parser cannot derive but a reviewer needs.
STATIC_NOTES = [
    "Alumni entries 'Dr. Samira Ghodratnama' (PhD, graduated 2021, line ~1996) and "
    "'Dr. Sami Ghodratnama' (Research Fellow, 2019, line ~2108) may be the same person "
    "— kept as two entries, exactly as in the source.",
    "Alumni entries 'Dr. Francesco Schiliro' (PhD, graduated 2023, line ~1896) and "
    "'Frank Schiliro' (MRes, graduated 2020, line ~2086) appear to be the same person "
    "under two name forms — kept as two entries, exactly as in the source.",
    "Source typos were kept verbatim (extraction only, not fixed): supervisor "
    "'Xuyun Xhang' (Jin Foo alumni entry, line ~1768); award text 'Google PhD "
    "Fellowahip 2023' (Mahdieh Labani); 'Excelence' in several award strings; name "
    "'Dr. Fariborz Sobnmanesh' (line ~1969, spelling as in source).",
    "The instruction called for dropping only Hadi Abachi's duplicated link (rule 3a), "
    "but because the unwrap map resolves the shared token to a hadi-m-abachi profile, "
    "Afrooz Sheikholeslami's identical link was dropped as well (people card AND her "
    "alumni entry) rather than shipping a link that provably points at someone else.",
]


# --------------------------------------------------------------------------- helpers

def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def doc_line(text: str, sec_start: int, clean: str, off: int) -> int:
    """Document line for offset `off` inside `clean` (the comment-blanked slice
    starting at `sec_start` in `text`). Comment blanking preserves newline
    counts but not byte offsets, so line numbers must be counted in `clean`."""
    return text.count("\n", 0, sec_start) + clean.count("\n", 0, off) + 1


def strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", " ", s)


def norm_ws(s: str) -> str:
    s = html.unescape(s).replace("\xa0", " ")
    return " ".join(s.split())


TITLE_PREFIX = re.compile(r"^(?:(?:a/)?prof\.?|dr\.?|mrs\.?|mr\.?|ms\.?)\s+", re.I)


def kebab_id(name: str) -> str:
    s = norm_ws(name)
    while True:
        stripped = TITLE_PREFIX.sub("", s)
        if stripped == s:
            break
        s = stripped
    import unicodedata

    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s


def classify_link(url: str) -> str:
    host = (urlparse(url).netloc or "").lower()
    if "linkedin.com" in host:
        return "linkedin"
    if "scholar.google" in host:
        return "scholar"
    return "website"


def is_mimecast(url: str) -> bool:
    host = (urlparse(url).netloc or "").lower()
    return any(h in host for h in MIMECAST_HOSTS)


def blank_comments(text: str) -> tuple[str, list[tuple[int, str]]]:
    """Replace HTML comments with an equal number of newlines (preserves line
    numbers); return cleaned text plus (position, comment-body) pairs."""
    comments: list[tuple[int, str]] = []

    def repl(m: re.Match) -> str:
        comments.append((m.start(), m.group(0)))
        return "\n" * m.group(0).count("\n")

    return re.sub(r"<!--.*?-->", repl, text, flags=re.S), comments


def yq(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def photo_exists_exact(rel: str) -> bool:
    """Case-exact existence check (Windows is case-insensitive; GitHub Pages is not)."""
    p = ROOT
    for part in rel.split("/"):
        if not p.is_dir():
            return False
        if part not in {e.name for e in p.iterdir()}:
            return False
        p = p / part
    return p.is_file()


# --------------------------------------------------------------------------- exceptions

class Exceptions:
    def __init__(self) -> None:
        self.dropped_links: list[str] = []
        self.ambiguities: list[str] = []
        self.commented_out: list[str] = []
        self.not_migrated: list[str] = []
        self.id_adjustments: list[str] = []
        self.informational: list[str] = []

    def render(self) -> str:
        out = [
            f"# Extraction exceptions — review queue",
            "",
            f"GENERATED from legacy index.html by scripts/extract-people.py on {GEN_DATE}.",
            "Every dropped/unresolvable link, parse ambiguity, and off-pattern entry from",
            "the People / Past Members migration is listed here for founder review.",
            "",
        ]

        def section(title: str, items: list[str]) -> None:
            out.append(f"## {title}")
            out.append("")
            if items:
                out.extend(f"- {i}" for i in items)
            else:
                out.append("- (none)")
            out.append("")

        section("Dropped or unresolvable links", self.dropped_links)
        section("Parse ambiguities and normalizations", self.ambiguities)
        section("Commented-out entries (skipped)", self.commented_out)
        section("Content not migrated (no schema field / out of scope)", self.not_migrated)
        section("ID adjustments", self.id_adjustments)
        section("Informational", self.informational)
        section("Reviewer notes (hand-checked observations)", list(STATIC_NOTES))
        return "\n".join(out)


# --------------------------------------------------------------------------- link resolution

def load_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    with MAP_CSV.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            mapping[row["wrapped"].strip()] = row["canonical"].strip()
    return mapping


def resolve_link(
    href: str,
    who: str,
    line: int,
    section: str,
    mapping: dict[str, str],
    exc: Exceptions,
) -> str | None:
    """Apply migration rules 1-3 to a raw href. Returns canonical URL or None."""
    raw = href
    href = href.strip()
    if raw != href and href:
        exc.ambiguities.append(
            f"{section}: {who} (line {line}) — href had surrounding whitespace; "
            f"trimmed and kept per rule 3(c): {href}"
        )
    if not href:
        return None

    if is_mimecast(href):
        canonical = mapping.get(href)
        if canonical is None:
            flipped = href[:-1] if href.endswith("/") else href + "/"
            canonical = mapping.get(flipped)
            if canonical is not None:
                exc.ambiguities.append(
                    f"{section}: {who} (line {line}) — mimecast URL matched the unwrap "
                    f"map only after toggling a trailing slash."
                )
        if canonical is None:
            exc.dropped_links.append(
                f"{section}: {who} (line {line}) — mimecast URL not present in "
                f"docs/audit/mimecast-unwrap-map.csv; link dropped: {href}"
            )
            return None
        if canonical == "UNRESOLVED":
            exc.dropped_links.append(
                f"{section}: {who} (line {line}) — mimecast URL is UNRESOLVED in the "
                f"unwrap map; link dropped: {href}"
            )
            return None
        href = canonical

    key = norm_ws(who).lower()
    key = TITLE_PREFIX.sub("", key)
    if key in KNOWN_WRONG:
        exc.dropped_links.append(
            f"{section}: {who} (line {line}) — KNOWN-WRONG link dropped. "
            f"{KNOWN_WRONG[key]} (href was: {raw.strip()})"
        )
        return None
    return href


# --------------------------------------------------------------------------- people section

CARD_RE = re.compile(
    r'<div class="gallery">\s*'
    r'<a\b[^>]*?href="([^"]*)"[^>]*>\s*'
    r"<img\b(.*?)/?>\s*"
    r"</a\s*>\s*"
    r'<div class="desc">(.*?)</div>',
    re.S,
)

GROUP_RULES = [
    (re.compile(r"founder and head", re.I), "director"),
    (re.compile(r"academic", re.I), "academics"),
    (re.compile(r"fellow|postdoc", re.I), "research-fellows"),
    (re.compile(r"ph\.?\s*d", re.I), "phd"),
    (re.compile(r"mres|mphil", re.I), "mres"),
    (re.compile(r"intern", re.I), "interns"),
    (re.compile(r"visiting", re.I), "visitors"),
]


def map_group(role: str) -> str | None:
    for rx, group in GROUP_RULES:
        if rx.search(role):
            return group
    return None


def parse_people(text: str, mapping: dict[str, str], exc: Exceptions) -> list[dict]:
    start = text.index('<section class="People" id="People">')
    end = text.index("</section>", start)
    section = text[start:end]
    clean, comments = blank_comments(section)

    # Record commented-out member cards.
    for cpos, cbody in comments:
        for cm in CARD_RE.finditer(cbody):
            desc = norm_ws(strip_tags(re.sub(r"<br\s*/?>", "\n", cm.group(3))))
            name = desc.split("(")[0].strip().rstrip(",")
            exc.commented_out.append(
                f"People: card for '{name}' is commented out in index.html "
                f"(line {line_of(text, start + cpos)}) — skipped."
            )

    expected = clean.count('<div class="gallery">')
    people: list[dict] = []
    seen_ids: dict[str, int] = {}

    for m in CARD_RE.finditer(clean):
        line = doc_line(text, start, clean, m.start())
        href, img_attrs, desc_html = m.group(1), m.group(2), m.group(3)

        src_m = re.search(r'src="([^"]*)"', img_attrs)
        alt_m = re.search(r'alt="([^"]*)"', img_attrs)
        photo = src_m.group(1).strip() if src_m else None
        alt = norm_ws(alt_m.group(1)) if alt_m else ""

        desc = norm_ws(strip_tags(re.sub(r"<br\s*/?>", "\n", desc_html)))
        role_m = re.search(r"\(([^()]*)\)", desc)
        if not role_m or "(" not in desc:
            exc.ambiguities.append(
                f"People: card at line {line} did not fit the 'Name (Role)' pattern "
                f"(desc: {desc!r}) — SKIPPED, needs manual entry."
            )
            continue
        name = desc[: desc.index("(")].strip().rstrip(",")
        role = role_m.group(1).strip()
        leftover = desc[role_m.end():].strip()
        if leftover:
            exc.ambiguities.append(
                f"People: {name} (line {line}) — stray text after role parentheses "
                f"kept out of the record: {leftover!r} (source markup is malformed; "
                f"role taken as {role!r})."
            )

        group = map_group(role)
        if group is None:
            exc.ambiguities.append(
                f"People: {name} (line {line}) — role {role!r} did not map to any "
                f"group — SKIPPED, needs manual entry."
            )
            continue

        link = resolve_link(href, name, line, "People", mapping, exc)

        pid = kebab_id(name)
        if pid in seen_ids:
            seen_ids[pid] += 1
            new_id = f"{pid}-{seen_ids[pid]}"
            exc.id_adjustments.append(
                f"People: duplicate id {pid!r} for {name} (line {line}) — emitted as "
                f"{new_id!r}."
            )
            pid = new_id
        else:
            seen_ids[pid] = 1

        # Informational checks.
        if alt and name:
            a, n = re.sub(r"[^a-z ]", "", alt.lower()), re.sub(r"[^a-z ]", "", name.lower())
            if a not in n and n not in a:
                exc.informational.append(
                    f"People: {name} (line {line}) — img alt text is {alt!r}, which "
                    f"does not match the card name; photo may belong to someone else "
                    f"(photo: {photo})."
                )
        if photo and not photo_exists_exact(photo):
            exc.informational.append(
                f"People: {name} (line {line}) — photo path {photo!r} does not exist "
                f"in the repo with exact case; will 404 on case-sensitive hosting."
            )
        if not href.strip():
            exc.informational.append(
                f"People: {name} (line {line}) — card href is empty; no link emitted "
                f"(expected per rule 2, listed in case a link should be sourced)."
            )

        entry: dict = {"id": pid, "name": name, "role": role, "group": group}
        if photo:
            entry["photo"] = photo
        if link:
            entry["links"] = {classify_link(link): link}
        people.append(entry)

    if len(people) != expected:
        exc.ambiguities.append(
            f"People: section contains {expected} gallery cards but {len(people)} were "
            f"parsed — the remainder are listed above as skipped/off-pattern."
        )
    return people


# --------------------------------------------------------------------------- past members

ANCHOR_RE = re.compile(r'<a\b[^>]*?href="([^"]*)"[^>]*>(.*?)</a\s*>', re.S)
SUP_LABEL_RE = re.compile(r"<b>[^<]*Supervisor[^<]*</b>\s*:?\s*", re.S)
BOUNDARY_RE = re.compile(r"<b\b|<br\b|<span\b")


def split_names(chunk: str) -> list[str]:
    txt = norm_ws(strip_tags(chunk))
    parts = re.split(r"[,;&]|\s+and\s+", txt)
    names: list[str] = []
    for p in parts:
        p = p.strip().rstrip(".").strip()
        if p and re.search(r"[A-Za-z]", p) and p not in names:
            names.append(p)
    return names


def take_until_boundary(s: str) -> str:
    b = BOUNDARY_RE.search(s)
    return s[: b.start()] if b else s


def parse_alumni(text: str, mapping: dict[str, str], exc: Exceptions) -> list[dict]:
    sec_start = text.index('<section class="People" id="PastMembers">')
    sec_end = text.index("</section>", sec_start)
    section = text[sec_start:sec_end]
    clean, comments = blank_comments(section)

    for cpos, cbody in comments:
        cm = ANCHOR_RE.search(cbody)  # first anchor = the person's own link
        if cm:
            name = norm_ws(strip_tags(cm.group(2)))
            if name:
                exc.commented_out.append(
                    f"Past Members: entry for '{name}' is commented out in index.html "
                    f"(line {line_of(text, sec_start + cpos)}) — skipped."
                )

    ol_start = clean.index("<ol reversed>")
    ol_end = clean.index("</ol>", ol_start)
    ol = clean[ol_start:ol_end]

    alumni: list[dict] = []
    for m in re.finditer(r"<li>(.*?)</li>", ol, re.S):
        li = m.group(1)
        line = doc_line(text, sec_start, clean, ol_start + m.start())

        am = ANCHOR_RE.search(li)
        if not am:
            exc.ambiguities.append(
                f"Past Members: <li> at line {line} has no leading anchor — SKIPPED: "
                f"{norm_ws(strip_tags(li))[:100]!r}"
            )
            continue
        href = am.group(1)
        name = norm_ws(strip_tags(am.group(2))).rstrip(",")
        rest = li[am.end():]

        deg_m = re.search(r"<b>\s*(.*?)\s*</b>", rest, re.S)
        degree = norm_ws(deg_m.group(1)) if deg_m else ""
        if not degree:
            exc.ambiguities.append(
                f"Past Members: {name} (line {line}) — no role/degree text found; "
                f"entry needs manual review."
            )
        elif degree.lower() == "student":
            exc.ambiguities.append(
                f"Past Members: {name} (line {line}) — role text in source is just "
                f"'Student' (degree level missing); kept verbatim."
            )

        # Year: look only at the text before the Thesis/Project Title label.
        title_m = re.search(r"<b>\s*(Thesis|Project)\s+Title\s*</b>\s*:?", rest, re.S)
        pre = rest[: title_m.start()] if title_m else rest
        pre_txt = norm_ws(strip_tags(pre))
        graduated: int | None = None
        g = re.search(r"Graduated\s+(\d{4})", pre_txt)
        if g:
            graduated = int(g.group(1))
        else:
            r = re.search(r"\b(\d{4})\s*[-–]\s*(\d{4})\b", pre_txt)
            if r:
                graduated = int(r.group(2))
                exc.ambiguities.append(
                    f"Past Members: {name} (line {line}) — source gives a period "
                    f"'{r.group(0)}' rather than 'Graduated YYYY'; end year "
                    f"{graduated} used for the required 'graduated' field — review."
                )
            else:
                y = re.search(r"\b((?:19|20)\d{2})\b", pre_txt)
                if y:
                    graduated = int(y.group(1))
                    exc.ambiguities.append(
                        f"Past Members: {name} (line {line}) — source gives a bare "
                        f"year '{y.group(1)}' (not 'Graduated YYYY'); used for the "
                        f"required 'graduated' field — review."
                    )
        if graduated is None:
            exc.ambiguities.append(
                f"Past Members: {name} (line {line}) — no year found; entry SKIPPED "
                f"(schema requires 'graduated')."
            )
            continue

        thesis: str | None = None
        if title_m:
            after = rest[title_m.end():]
            chunk = take_until_boundary(after)
            t = norm_ws(strip_tags(chunk)).strip().rstrip(",").strip()
            if t.startswith('"'):
                t = t[1:]
            if t.endswith('"'):
                t = t[:-1]
            thesis = t.strip() or None
            if title_m.group(1) == "Project" and thesis:
                exc.ambiguities.append(
                    f"Past Members: {name} (line {line}) — source has a 'Project "
                    f"Title' (not a thesis); stored in the 'thesis' field — review."
                )
            # Links embedded inside the title are not migrated (no schema field).
            for im in ANCHOR_RE.finditer(chunk):
                inner = im.group(1).strip()
                if not inner:
                    continue
                resolved = inner
                if is_mimecast(inner):
                    resolved = mapping.get(inner) or mapping.get(
                        inner[:-1] if inner.endswith("/") else inner + "/"
                    ) or "UNRESOLVED"
                note = ""
                if "linkedin.com" in resolved:
                    note = (
                        " NOTE: this title link is a LinkedIn profile — possibly the "
                        "person's own link misplaced in the source."
                    )
                exc.not_migrated.append(
                    f"Past Members: {name} (line {line}) — link embedded in the "
                    f"thesis/project title has no schema field and was not migrated: "
                    f"{resolved}{' (wrapped: ' + inner + ')' if resolved != inner else ''}."
                    f"{note}"
                )

        supervisors: list[str] = []
        for sm in SUP_LABEL_RE.finditer(rest):
            chunk = take_until_boundary(rest[sm.end():])
            for n in split_names(chunk):
                if n not in supervisors:
                    supervisors.append(n)
        for n in supervisors:
            if not re.match(r"[A-Za-z]", n):
                exc.ambiguities.append(
                    f"Past Members: {name} (line {line}) — supervisor name {n!r} "
                    f"starts with a stray character in the source; kept verbatim."
                )

        award: str | None = None
        aw = re.search(r"Awarded:", rest)
        if aw:
            award = norm_ws(strip_tags(rest[aw.end():])).strip().rstrip(";").strip()
            award = award or None

        link = resolve_link(href, name, line, "Past Members", mapping, exc)

        alumni.append(
            {
                "name": name,
                "degree": degree,
                "graduated": graduated,
                "thesis": thesis,
                "supervisors": supervisors,
                "award": award,
                "link": link,
            }
        )

    # IDs (kebab of name); de-duplicate collisions with a degree-based suffix.
    by_id: dict[str, list[dict]] = {}
    for a in alumni:
        by_id.setdefault(kebab_id(a["name"]), []).append(a)
    for base, group in by_id.items():
        if len(group) == 1:
            group[0]["id"] = base
        else:
            for a in group:
                a["id"] = f"{base}-{kebab_id(a['degree']) or 'entry'}"
            exc.id_adjustments.append(
                f"Alumni: {len(group)} entries share the name-derived id {base!r} "
                f"({group[0]['name']}); ids emitted with degree suffixes: "
                + ", ".join(repr(a["id"]) for a in group)
                + "."
            )

    # ------- Research Internship Students list (out of scope for alumni.yml) -------
    ul_m = re.search(r"<ul>(.*?)</ul>", clean[ol_end:], re.S)
    if ul_m and "Research Internship Students" in ul_m.group(1):
        ul = ul_m.group(1)
        ul_off = ol_end + ul_m.start(1)  # offset of ul content within `clean`
        interns: list[tuple[str, str, str, int]] = []  # name, year, href, line
        for im in re.finditer(
            r'<a\b[^>]*?href="([^"]*)"[^>]*>(.*?)</a\s*>\s*\((\d{4})\)', ul, re.S
        ):
            interns.append(
                (
                    norm_ws(strip_tags(im.group(2))),
                    im.group(3),
                    im.group(1).strip(),
                    doc_line(text, sec_start, clean, ul_off + im.start()),
                )
            )
        if interns:
            names = ", ".join(f"{n} ({y})" for n, y, _, _ in interns)
            exc.not_migrated.append(
                f"Past Members: the 'Research Internship Students' list "
                f"({len(interns)} names, index.html lines "
                f"~{interns[0][3]}–{interns[-1][3]}) has no thesis/graduation data "
                f"and does not fit the alumni schema; NOT migrated to alumni.yml — "
                f"founder to decide where it lives. Names: {names}."
            )
            hrefs: dict[str, list[tuple[str, int]]] = {}
            for n, _, h, ln in interns:
                if h:
                    hrefs.setdefault(h, []).append((n, ln))
            for h, users in hrefs.items():
                if len(users) > 1:
                    who = " and ".join(f"{n} (line {ln})" for n, ln in users)
                    exc.dropped_links.append(
                        f"Past Members (internship list): {who} share the SAME href "
                        f"({h}) — per migration rule 3(b) neither link can be "
                        f"trusted; both would be dropped if this list is ever migrated."
                    )
    exc.not_migrated.append(
        "Past Members: the 'Lab Performance' end-of-year LinkedIn post links "
        "(index.html lines ~2216–2260) are not people entries and were not migrated."
    )

    return alumni


# --------------------------------------------------------------------------- emit

def emit_people(people: list[dict]) -> str:
    lines = [YAML_HEADER]
    for p in people:
        lines.append(f"- id: {yq(p['id'])}")
        lines.append(f"  name: {yq(p['name'])}")
        lines.append(f"  role: {yq(p['role'])}")
        lines.append(f"  group: {yq(p['group'])}")
        if p.get("photo"):
            lines.append(f"  photo: {yq(p['photo'])}")
        if p.get("links"):
            lines.append("  links:")
            for k in ("linkedin", "scholar", "website"):
                if k in p["links"]:
                    lines.append(f"    {k}: {yq(p['links'][k])}")
    return "\n".join(lines) + "\n"


def emit_alumni(alumni: list[dict]) -> str:
    lines = [YAML_HEADER]
    for a in alumni:
        lines.append(f"- id: {yq(a['id'])}")
        lines.append(f"  name: {yq(a['name'])}")
        lines.append(f"  degree: {yq(a['degree'])}")
        lines.append(f"  graduated: {a['graduated']}")
        if a.get("thesis"):
            lines.append(f"  thesis: {yq(a['thesis'])}")
        if a.get("supervisors"):
            lines.append("  supervisors:")
            for s in a["supervisors"]:
                lines.append(f"    - {yq(s)}")
        if a.get("award"):
            lines.append(f"  award: {yq(a['award'])}")
        if a.get("link"):
            lines.append(f"  link: {yq(a['link'])}")
    return "\n".join(lines) + "\n"


def main() -> None:
    text = INDEX.read_text(encoding="utf-8")
    mapping = load_map()
    exc = Exceptions()

    people = parse_people(text, mapping, exc)
    alumni = parse_alumni(text, mapping, exc)

    PEOPLE_OUT.write_text(emit_people(people), encoding="utf-8", newline="\n")
    ALUMNI_OUT.write_text(emit_alumni(alumni), encoding="utf-8", newline="\n")
    EXCEPTIONS_OUT.write_text(exc.render() + "\n", encoding="utf-8", newline="\n")

    n_exc = sum(
        len(v)
        for v in (
            exc.dropped_links,
            exc.ambiguities,
            exc.commented_out,
            exc.not_migrated,
            exc.id_adjustments,
            exc.informational,
        )
    )
    print(f"people:  {len(people)} entries -> {PEOPLE_OUT.relative_to(ROOT)}")
    print(f"alumni:  {len(alumni)} entries -> {ALUMNI_OUT.relative_to(ROOT)}")
    print(
        f"exceptions: {n_exc} recorded "
        f"(dropped links {len(exc.dropped_links)}, ambiguities {len(exc.ambiguities)}, "
        f"commented-out {len(exc.commented_out)}, not-migrated {len(exc.not_migrated)}, "
        f"id adjustments {len(exc.id_adjustments)}, informational {len(exc.informational)}) "
        f"-> {EXCEPTIONS_OUT.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
