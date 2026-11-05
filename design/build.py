#!/usr/bin/env python3
"""Build the DESIGN COPY of the tracker (a private claude.ai artifact) from the live page.

    python3 design/build.py [seed.json]

Reads ./index.html (exactly what is deployed), swaps the three Supabase scripts for design/design-adapter.js,
removes the document wrapper tags (the artifact host adds its own), and writes design/dist/:
    index.html, design-adapter.js, seed.json (a tracker backup), export.js, exceljs.min.js, xlsx.full.min.js
Nothing in design/dist talks to the live database.
"""
import pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'design' / 'dist'
DIST.mkdir(parents=True, exist_ok=True)

page = (ROOT / 'index.html').read_text(encoding='utf-8')
live_scripts = '<script src="config.js"></script>\n<script src="supabase.js"></script>\n<script src="sb-adapter.js"></script>'
assert page.count(live_scripts) == 1, 'live script tags not found: index.html changed shape'
page = page.replace(live_scripts, '<script src="design-adapter.js"></script>')
# claude.ai installs its own window.claude on the page after our scripts, which would replace the design
# stand-in; so the design copy calls the stand-in under its own name (window.AQS_RT) instead.
n = page.count("claude.use(")
assert n >= 4, 'expected the tracker to call claude.use()'
page = page.replace("claude.use(", "AQS_RT.use(")
# the artifact host supplies <!doctype>, <html>, <head>, <body>, charset and viewport
for pat in [r'<!doctype html>\s*', r'<html[^>]*>\s*', r'</?head>\s*', r'<body>\s*', r'</body>\s*', r'</html>\s*',
            r'<meta charset="utf-8">\s*', r'<meta name="viewport"[^>]*>\s*', r'<meta name="robots"[^>]*>\s*']:
    page = re.sub(pat, '', page, count=1, flags=re.I)
assert page.lstrip().startswith('<title>'), 'expected <title> first'
(DIST / 'index.html').write_text(page, encoding='utf-8')

shutil.copy(ROOT / 'design' / 'design-adapter.js', DIST / 'design-adapter.js')
for f in ['export.js', 'exceljs.min.js', 'xlsx.full.min.js']:
    shutil.copy(ROOT / f, DIST / f)
if len(sys.argv) > 1:
    shutil.copy(sys.argv[1], DIST / 'seed.json')
assert (DIST / 'seed.json').exists(), 'pass a backup JSON the first time: python3 design/build.py backup.json'
print('built', DIST, sorted(p.name for p in DIST.iterdir()))
