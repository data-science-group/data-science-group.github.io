#!/usr/bin/env python3
"""Media diet (locked decision D4): compress gallery photos to web derivatives.

- Hackathon galleries (BigDataSociety/Hackathon/*/photos/*.jpg): resize to
  <=1600px long edge, JPEG q78, EXIF stripped (privacy), skip files already
  small. Filenames unchanged -> no HTML edits needed.
- AIPA 2024 gallery (AIPA_workshop/2024/Photos/*.png): photographs stored as
  full-res PNG; converted to JPEG (same basename, .jpg), originals removed,
  gallery HTML updated to .jpg references.

Originals remain in git history; the archive-repo export happens when the
founder creates that repo (see docs/audit + D4).

Run: python scripts/media-diet.py [--dry]
"""
import glob
import os
import sys

from PIL import Image

DRY = "--dry" in sys.argv
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(ROOT)
MAX_EDGE = 1600
QUALITY = 78
SKIP_UNDER = 300 * 1024

def shrink(path, out_path=None):
    out_path = out_path or path
    before = os.path.getsize(path)
    if before < SKIP_UNDER and out_path == path:
        return before, before, False
    img = Image.open(path)
    img = img.convert("RGB")
    if max(img.size) > MAX_EDGE:
        r = MAX_EDGE / max(img.size)
        img = img.resize((round(img.width * r), round(img.height * r)), Image.LANCZOS)
    if not DRY:
        img.save(out_path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        if out_path != path:
            os.remove(path)
    after = os.path.getsize(out_path) if not DRY else 0
    return before, after, True

total_before = total_after = changed = 0

# hackathon jpgs (in place)
for p in glob.glob("BigDataSociety/Hackathon/*/photos/*.jpg") + glob.glob("BigDataSociety/Hackathon/*/photos/*.JPG"):
    b, a, did = shrink(p)
    total_before += b; total_after += a if did else b; changed += did

# AIPA 2024 pngs -> jpgs
png_renames = []
for p in sorted(glob.glob("AIPA_workshop/2024/Photos/AAIP_Microsoft-*.png")):
    out = p[:-4] + ".jpg"
    b, a, did = shrink(p, out)
    total_before += b; total_after += a if did else b; changed += did
    png_renames.append((os.path.basename(p), os.path.basename(out)))

# update the AIPA gallery HTML references
gal = "AIPA_workshop/2024/Photos/index.html"
if png_renames and not DRY and os.path.exists(gal):
    html = open(gal, encoding="utf-8", errors="replace").read()
    n = html.count("AAIP_Microsoft-")
    html = html.replace(".png", ".jpg")
    # logos in that page may be .png too — restore any non-photo names
    for keep in ("Microsoft.jpg", "Fujitsu.jpg", "aai_logo.jpg", "mq.jpg", "SystemEthics.jpg"):
        html = html.replace(keep, keep[:-4] + ".png")
    open(gal, "w", encoding="utf-8").write(html)
    print(f"gallery HTML updated ({n} photo refs)")

print(f"files touched: {changed}; {total_before/1e9:.2f} GB -> {total_after/1e9:.2f} GB"
      + (" (dry run)" if DRY else ""))
