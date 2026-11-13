#!/usr/bin/env python3
"""Inline data + JS into the dashboard template.

Writes:
  dist/dashboard.html           full HTML document, open directly in a browser
  dist/dashboard_fragment.html  page body only, for hosts that supply their own <html> wrapper
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)

tpl = (ROOT / "dashboard" / "template.html").read_text()
data = (ROOT / "data" / "dashboard_data.json").read_text()
core = (ROOT / "dashboard" / "core.js").read_text()
analysis = (ROOT / "dashboard" / "analysis.js").read_text()
app = (ROOT / "dashboard" / "app.js").read_text()

# '</' inside inline JSON would end the script tag early
data_js = "var DATA = " + data.replace("</", "<\\/") + ";"
page = (tpl.replace("/*__DATA__*/", data_js)
           .replace("/*__CORE__*/", core)
           .replace("/*__ANALYSIS__*/", analysis)
           .replace("/*__APP__*/", app))

(DIST / "dashboard_fragment.html").write_text(page)
full = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="color-scheme" content="light dark">\n'
        '<style>body{margin:0}</style>\n</head>\n<body>\n' + page + "\n</body>\n</html>\n")
(DIST / "dashboard.html").write_text(full)
print(f"wrote dist/dashboard.html ({len(full)/1e6:.2f} MB)")
