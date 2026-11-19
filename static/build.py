"""Builds the static online demo of the CityOps dashboard (no server needed).

    python static/build.py <output-folder>        (run from the geo-stack folder)

Copies the dashboard from web/site, adds static-api.js and the exported sample data, switches the
page to in-browser data, and writes a README.md with the Hugging Face Static Space settings.
The output works on any static host (Hugging Face Static Spaces, GitHub Pages, Netlify, ...).

The sample data in static/data was exported from the PostGIS database (see the README).
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "web" / "site"
STATIC = ROOT / "static"

SPACE_README = """---
title: CityOps Cairo Service Requests
emoji: 🗺️
colorFrom: green
colorTo: blue
sdk: static
pinned: false
short_description: Web GIS dashboard for Cairo city service requests
---

# CityOps · Cairo service requests

A web GIS dashboard for city service requests across 21 real districts of central Cairo: KPIs and
charts, filters, a district map coloured by open requests, hotspots, "closest requests" and
"requests within a radius" searches, and adding, approving and deleting requests on the map.

This online version runs entirely in the browser from exported sample data; a visitor's changes stay
in their own browser. The full version runs on PostgreSQL/PostGIS and GeoServer (WMS, WFS, WFS-T,
parameterised SQL views) behind Nginx.

District boundaries: CAPMAS / OCHA via geoBoundaries (CC BY 3.0 IGO). Requests are synthetic sample data.
"""

FOOTER_OLD = '<footer class="credits">Sample data for demonstration. District boundaries: CAPMAS (CC BY 3.0 IGO).</footer>'
FOOTER_NEW = ('<footer class="credits">Online demo: it runs in your browser and your changes stay in this browser '
              '(<a href="#" id="resetDemo">reset sample data</a>). The full version runs on PostGIS and GeoServer. '
              'Sample data; district boundaries: CAPMAS (CC BY 3.0 IGO).</footer>')


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise SystemExit(f"index.html: expected exactly one {old[:50]!r}")
    return text.replace(old, new)


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "app.js", "app.css", "static-api.js", "data", "README.md"):
        target = out / name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()

    for name in ("app.js", "app.css"):
        shutil.copy2(SITE / name, out / name)
    shutil.copy2(STATIC / "static-api.js", out / "static-api.js")
    shutil.copytree(STATIC / "data", out / "data")

    html = (SITE / "index.html").read_text(encoding="utf-8")
    script = '<script src="app.js'
    html = replace_once(html, script,
                        '<script>window.CITYOPS_STATIC = true;</script>\n'
                        '<script src="static-api.js?v=1"></script>\n' + script)
    html = replace_once(html, FOOTER_OLD, FOOTER_NEW)
    (out / "index.html").write_text(html, encoding="utf-8", newline="\n")
    (out / "README.md").write_text(SPACE_README, encoding="utf-8", newline="\n")
    print(f"Static demo written to {out}")


if __name__ == "__main__":
    main()
