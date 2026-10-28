"""Gera index.html (GitHub Pages, com mapa Leaflet/OpenStreetMap) a partir de src/artifact.html.

Uso:  py -I build.py
src/artifact.html é a fonte única (também publicável como página claude.ai, sem mapa externo).
"""
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "src" / "artifact.html"
OUT = HERE / "index.html"
LEAFLET = (
    '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">'
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>\n'
)

html = SRC.read_text(encoding="utf-8")
script = re.search(r"<script>(.*)</script>", html, re.S).group(1)
check = HERE / "_check.js"
check.write_text(script, encoding="utf-8")
try:
    subprocess.run(["node", "--check", str(check)], check=True)
except (subprocess.CalledProcessError, FileNotFoundError) as e:
    print("Verificação de sintaxe falhou ou node ausente:", e)
    if isinstance(e, subprocess.CalledProcessError):
        sys.exit(1)
finally:
    check.unlink(missing_ok=True)

full = (
    '<!doctype html>\n<html lang="pt"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    + LEAFLET
    + html.replace('<div id="root"></div>', '</head><body style="margin:0">\n<div id="root"></div>', 1)
    + "\n</body></html>"
)
OUT.write_text(full, encoding="utf-8")
print(f"index.html gerado ({len(full)} caracteres)")
