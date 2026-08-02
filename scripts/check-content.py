#!/usr/bin/env python3
"""Content-hygiene gate for the DSRL site (run on source and on built output).

Fails (exit 1) if it finds:
  - Mimecast / Safelinks email-rewrite URLs
  - Zoom join links with embedded passcodes, or Meeting ID/Passcode text
  - private-ish file types in the web root (.docx/.dotx/.potx receipts etc. outside allowlisted paths)
  - raw email lists (3+ addresses within a 5-line window outside allowlisted files)
  - Windows-backslash paths inside href/src attributes

Usage: python scripts/check-content.py [ROOT] [--quiet]
Default ROOT is the repo root (parent of scripts/).
"""
import os
import re
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-")
                       else os.path.join(os.path.dirname(__file__), ".."))
QUIET = "--quiet" in sys.argv

SKIP_DIRS = {".git", "node_modules", "scripts", ".playwright-mcp", "dist", ".astro"}
# docs/ is exempt from LINK-ROT patterns (audit reports legitimately catalogue rot)
# but is still scanned for CREDENTIAL patterns — secrets never get a pass.
DOCS_PREFIX = "docs/"
TEXT_EXT = {".html", ".htm", ".md", ".yml", ".yaml", ".json", ".js", ".mjs", ".ts", ".astro", ".css", ".xml", ".txt", ".bib", ".csv"}
# document formats that should not ship in the public web root unless allowlisted
DOC_EXT = {".docx", ".doc", ".dotx", ".potx", ".xlsx"}
DOC_ALLOW = {  # repo-relative paths of legitimately published student resources (inventory: KEEP)
    "MQ_Assessment_Form.docx",
    "weekly-report.docx",
    "people/aminbeheshti/internship/MQ_Assessment_Form.docx",
    "people/aminbeheshti/DataScienceProject/mid-report-structure.docx",
    "people/aminbeheshti/DataScienceProject/midreport-structure.docx",
    "people/aminbeheshti/DataScienceProject/final-report-structure.docx",
    "people/aminbeheshti/DataScienceProject/finalreport-structure.docx",
    "people/aminbeheshti/DataScienceProject/Final-Report-Template.dotx",
    "people/aminbeheshti/DataScienceProject/FinalReport-Template.dotx",
    "people/aminbeheshti/DataScienceProject/PowerPoint-template.potx",
    "AIPA_workshop/2022/AIPA22_Copyight.docx",
}
EMAIL_ALLOW_FILES = set()  # none currently

CREDENTIAL_PATTERNS = [  # scanned EVERYWHERE, including docs/
    ("zoom-join-with-pwd", re.compile(r"zoom\.us/j/\d+\?pwd=(?!REDACTED)")),
    ("zoom-credential-text", re.compile(r"(Meeting ID\s*(:|</b>)|Passcode\s*(:|</b>))", re.I)),
]
LINKROT_PATTERNS = [  # skipped under docs/ (audit reports catalogue these on purpose)
    ("mimecast-url", re.compile(r"(protect-au\.mimecast\.com|mimecastprotect\.com)")),
    ("safelinks-url", re.compile(r"safelinks\.protection\.outlook\.com")),
    ("backslash-in-link", re.compile(r"""(?:href|src)\s*=\s*["'][^"':]*\\""")),
]
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

findings = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        p = os.path.join(dirpath, fn)
        rel = os.path.relpath(p, ROOT).replace("\\", "/")
        ext = os.path.splitext(fn)[1].lower()
        in_docs = rel.startswith(DOCS_PREFIX)
        if ext in DOC_EXT and rel not in DOC_ALLOW and not in_docs:
            findings.append((rel, 0, "unexpected-office-doc", rel))
            continue
        if ext not in TEXT_EXT:
            continue
        try:
            lines = open(p, encoding="utf-8", errors="replace").read().splitlines()
        except OSError:
            continue
        patterns = CREDENTIAL_PATTERNS if in_docs else CREDENTIAL_PATTERNS + LINKROT_PATTERNS
        for i, line in enumerate(lines, 1):
            for name, rx in patterns:
                if rx.search(line):
                    findings.append((rel, i, name, line.strip()[:120]))
        # email-list heuristic: 3+ distinct addresses within any 5-line window
        if rel not in EMAIL_ALLOW_FILES and ext in {".txt", ".csv", ".md"}:
            for i in range(len(lines)):
                window = "\n".join(lines[i:i + 5])
                emails = set(EMAIL_RE.findall(window))
                if len(emails) >= 3:
                    findings.append((rel, i + 1, "email-list", f"{len(emails)} addresses in 5 lines"))
                    break

if findings:
    if not QUIET:
        for rel, ln, kind, detail in findings[:200]:
            print(f"FAIL {kind:22s} {rel}:{ln}  {detail}")
        if len(findings) > 200:
            print(f"... and {len(findings) - 200} more")
    print(f"check-content: {len(findings)} finding(s) — FAIL")
    sys.exit(1)
print("check-content: clean")
