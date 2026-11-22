#!/usr/bin/env python3
"""Build the photo gallery on Day1_Program.html.

Usage:  python3 tools/build_gallery.py /path/to/folder/with/original/photos

Reads every .jpg/.jpeg/.png/.heic-free image in the folder (sorted by capture time), writes
  Photos/full/NNN.jpg    (max 2000 px on the long side)
  Photos/thumbs/NNN.jpg  (max 400 px on the long side)
  Photos/main/NNN.jpg    (1300 px, only for the file names listed in MAIN)
and replaces the blocks between <!-- MAIN START/END --> and <!-- GALLERY START/END -->
in Day1_Program.html. Re-running rebuilds everything from scratch.
"""
import sys, shutil, html
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "Day1_Program.html"
FULL, THUMB = ROOT / "Photos" / "full", ROOT / "Photos" / "thumbs"
EXTS = {".jpg", ".jpeg", ".png"}
MAIN_DIR = ROOT / "Photos" / "main"
# Crowd shots shown above the program, by original file name.
MAIN = ['2026-AAIP at Google-quickpublish-8.jpg', '2026-AAIP at Google-quickpublish-43.jpg', '2026-AAIP at Google-quickpublish-19.jpg', '2026-AAIP at Google-quickpublish-27.jpg', '2026-AAIP at Google-quickpublish-55.jpg', '2026-AAIP at Google-quickpublish-20.jpg']

def save(img, path, size, quality):
    im = img.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    im.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    return im.size

def main(src):
    src = Path(src).expanduser()
    files = sorted(p for p in src.iterdir() if p.suffix.lower() in EXTS and not p.name.startswith("."))
    # Order photos by capture time (EXIF), so they follow the program; ties keep file-name order.
    def taken(p):
        try:
            ex = Image.open(p).getexif()
            return ex.get_ifd(0x8769).get(36867) or ex.get(306) or ""
        except Exception:
            return ""
    files.sort(key=lambda p: (taken(p), p.name))
    if not files:
        sys.exit(f"No photos found in {src}")
    for d in (FULL, THUMB, MAIN_DIR):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
    items = []
    for i, p in enumerate(files, 1):
        name = f"{i:03d}.jpg"
        img = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        save(img, FULL / name, 2000, 85)
        if p.name in MAIN:
            save(img, MAIN_DIR / name, 1300, 82)
        w, h = save(img, THUMB / name, 400, 78)
        items.append(
            f'    <a href="Photos/full/{name}"><img src="Photos/thumbs/{name}" width="{w}" height="{h}" '
            f'loading="lazy" alt="Workshop photo {i}"></a>'
        )
        print(f"{i}/{len(files)} {p.name}")
    block = (
        '  <hr>\n  <div class="photos" id="photos">\n    <h3>PHOTOS</h3>\n    <div class="gallery" id="gallery">\n'
        + "\n".join(items) + "\n    </div>\n  </div>\n"
    )
    main_nums = [i for i, p in enumerate(files, 1) if p.name in MAIN]
    main_items = "\n".join(
        f'    <a href="Photos/full/{n:03d}.jpg" target="_blank" rel="noopener"><img src="Photos/main/{n:03d}.jpg" alt="Workshop audience {k}"></a>'
        for k, n in enumerate(main_nums, 1)
    )
    main_block = '  <div class="mainphotos">\n' + main_items + "\n  </div>\n"
    main_block += '  <p class="center morephotos"><a href="#photos"><b>See all workshop photos below &#8595;</b></a></p>\n'

    s = PAGE.read_text(encoding="utf-8")
    for a, b, new in (("<!-- MAIN START -->", "<!-- MAIN END -->", main_block), ("<!-- GALLERY START -->", "<!-- GALLERY END -->", block)):
        i, j = s.index(a) + len(a), s.index(b)
        s = s[:i] + "\n" + new + "  " + s[j:]
    PAGE.write_text(s, encoding="utf-8")
    print(f"Done: {len(files)} photos added to {PAGE.name}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
