#!/usr/bin/env python3
"""Founder-approved link surgery on the preserved legacy home page (index.html).

Zero visual change; only link targets/attributes:
  1. Every Mimecast-wrapped URL -> its verified canonical destination
     (docs/audit/mimecast-unwrap-map.csv, built by following each redirect).
  2. Empty href="" anchors -> href removed (dead links stop reloading the page).
  3. Documented person-link corrections (founder-resolved 2026-07-04):
     Hadi Abachi gets HIS verified URL; Afrooz Sheikholeslami unlinked (her card
     carried Hadi's URL); Jahanandish/Kalantari unlinked (shared URL, owner
     unknown); Akramah Rashid's leading-space href trimmed; Mahdieh Labani's
     malformed site-relative URL fixed; two wrong img alt texts corrected
     (photos confirmed correct by founder).

Usage: python scripts/unwrap-links.py [--check]   (--check = report only)
"""
import csv
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PAGE = os.path.join(ROOT, "index.html")
MAP = os.path.join(ROOT, "docs", "audit", "mimecast-unwrap-map.csv")
CHECK = "--check" in sys.argv

s = open(PAGE, encoding="utf-8").read()
orig = s
report = []

# --- 1. mimecast unwrap ------------------------------------------------------
unwrap = {}
with open(MAP, encoding="utf-8") as fh:
    for row in csv.DictReader(fh):
        if row["canonical"] and row["canonical"] != "UNRESOLVED":
            unwrap[row["wrapped"]] = row["canonical"]

hits = 0
for wrapped, canonical in sorted(unwrap.items(), key=lambda kv: -len(kv[0])):
    n = s.count(wrapped)
    if n:
        s = s.replace(wrapped, canonical)
        hits += n
report.append(f"mimecast URLs replaced: {hits}")
left = len(re.findall(r"(protect-au\.mimecast\.com|mimecastprotect\.com)", s))
report.append(f"mimecast references remaining: {left}")

# --- 2. empty hrefs ----------------------------------------------------------
empty_before = len(re.findall(r'href="\s*"', s))
s = re.sub(r'\s*href="\s*"', "", s)
report.append(f"empty hrefs removed: {empty_before}")

# --- 3. documented person-link corrections -----------------------------------
fixes = 0
# Afrooz Sheikholeslami's card/list entries carried Hadi Abachi's URL — unlink hers.
# (After unwrapping, both point to hadi-m-abachi; Hadi keeps his, Afrooz loses hers.)
HADI = "https://www.linkedin.com/in/hadi-m-abachi-99956a91/"
# people card (img alt Afrooz) and alumni entry: unlink by locating the anchor
# whose visible text/alt is Afrooz but href is Hadi's.
pat_afrooz = re.compile(
    r'<a([^>]*)href="' + re.escape(HADI) + r'"([^>]*)>(\s*(?:<[^>]+>\s*)*?[^<]*Afrooz[^<]*)',
    re.I,
)
def _unlink_afrooz(m):
    global fixes
    fixes += 1
    return "<a" + m.group(1) + m.group(2) + ">" + m.group(3)
s2 = pat_afrooz.sub(_unlink_afrooz, s)
# also the card form: <a href=HADI ...> ... <img ... alt="...Afrooz..." — handle img-anchored card
if s2 == s:
    # card markup: anchor wraps img whose sibling text contains Afrooz; do a windowed scan
    idx = 0
    out = []
    changed = 0
    anchor_re = re.compile(r'<a[^>]*href="' + re.escape(HADI) + r'"[^>]*>')
    for m in anchor_re.finditer(s):
        window = s[m.end(): m.end() + 400]
        if "Afrooz" in window:
            out.append((m.start(), m.end()))
    for start, end in reversed(out):
        frag = s[start:end].replace(f'href="{HADI}"', "")
        s = s[:start] + frag + s[end:]
        changed += 1
    fixes += changed
else:
    s = s2
report.append(f"Afrooz unlink operations: {fixes}")

# Zahra Jahanandish / Arian Kalantari — shared URL, owner unknown: unlink both.
SHARED = re.compile(r'href="https://www\.linkedin\.com/in/arian-kalantari-3b9160184[^"]*"')
n = 0
for name in ("Jahanandish", "Kalantari"):
    anchor_re = re.compile(r'<a[^>]*href="https://www\.linkedin\.com/in/arian-kalantari[^"]*"[^>]*>')
    for m in list(anchor_re.finditer(s)):
        window = s[m.end(): m.end() + 300]
        if name in window:
            frag = re.sub(r'\s*href="[^"]*"', "", s[m.start():m.end()], count=1)
            s = s[:m.start()] + frag + s[m.end():]
            n += 1
            break
report.append(f"Jahanandish/Kalantari unlinks: {n}")

# Akramah Rashid: leading-space href
before = s
s = s.replace('href=" https://www.linkedin.com/in/akramah-rashid', 'href="https://www.linkedin.com/in/akramah-rashid')
report.append(f"Akramah href trimmed: {before != s}")

# Mahdieh Labani: malformed site-relative LinkedIn URL
before = s
s = re.sub(r'href="(?:https://data-science-group\.github\.io/)?www\.linkedin\.com/in/mahdieh-labani[^"]*"',
           'href="https://www.linkedin.com/in/heidi-labani/"', s)
s = s.replace('href="www.linkedin.com/in/mahdieh-labani', 'href="https://www.linkedin.com/in/heidi-labani/')
report.append(f"Labani URL fixed: {before != s}")

# Wrong alt texts (photos confirmed correct; alt was the defect)
before = s
s = re.sub(r'(DexuanDing[^>]{0,120}?alt=")Hanfeng Liao(")', r"\1Dexuan Ding\2", s)
s = re.sub(r'(MohammadPas[^>]{0,120}?alt=")Sobhan Salarian(")', r"\1MohammadAli Pashanj\2", s)
# alt may precede src — second pass with reversed order
s = re.sub(r'(alt=")Hanfeng Liao("[^>]{0,160}?DexuanDing)', r"\1Dexuan Ding\2", s)
s = re.sub(r'(alt=")Sobhan Salarian("[^>]{0,160}?MohammadPas)', r"\1MohammadAli Pashanj\2", s)
report.append(f"alt texts fixed: {before != s}")

# insecure self-links: own-domain http:// -> https://
before = s
s = s.replace('href="http://data-science-group.github.io', 'href="https://data-science-group.github.io')
report.append(f"own-domain http->https: {before != s}")

print("\n".join(report))
if CHECK:
    print("(check mode — nothing written)")
elif s != orig:
    open(PAGE, "w", encoding="utf-8").write(s)
    print(f"WROTE {PAGE} ({len(orig)} -> {len(s)} bytes)")
else:
    print("no changes")
