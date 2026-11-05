"""
Import nocturne Sage X3 -> feuille Google de l'app « Supervisores P&C » (backend Apps Script).

Lit les CSV déposés par l'informatique et les envoie à l'App Web Apps Script, par paquets :
- Stock       : remplacement complet (le fichier = l'état du jour).
- Expéditions : remplacement complet (fenêtre glissante 30 jours).
- KPI mensuels (optionnel) : mise à jour par site + mois.
Une ligne est ajoutée dans la feuille « imports » (visible dans Bastidor → Painel).

Aucune dépendance hors bibliothèque standard Python 3.9+.
Configuration : config.ini à côté de ce script, section [gsheets] (voir config.example.ini).
  url        = URL de l'App Web (…/exec)
  import_key = clé affichée par la fonction setup (Apps Script → Exécutions → journal),
               ou Paramètres du projet → Propriétés du script → IMPORT_KEY
Planification : installer_tache_nocturne.ps1 (remplacer import_sage.py par import_gsheets.py).
"""
from __future__ import annotations

import configparser
import json
import logging
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from import_sage import COLS, read_csv
from import_supabase import to_rows

HERE = Path(__file__).resolve().parent
CHUNK = 2000
log = logging.getLogger("import_gsheets")


def load_config() -> configparser.SectionProxy:
    cfg = configparser.ConfigParser()
    path = HERE / "config.ini"
    if not path.exists():
        sys.exit(f"config.ini introuvable ({path}). Copier config.example.ini -> config.ini et le remplir.")
    cfg.read(path, encoding="utf-8-sig")  # tolère le BOM ajouté par le Bloc-notes Windows
    if "gsheets" not in cfg:
        sys.exit("config.ini : section [gsheets] manquante (url, import_key, dossier_csv).")
    return cfg["gsheets"]


class AppsScript:
    def __init__(self, url: str, key: str):
        self.url, self.key = url.strip(), key.strip()

    def call(self, payload: dict) -> dict:
        body = json.dumps({"action": "import", "key": self.key, **payload}).encode()
        for attempt in range(5):
            # text/plain : même format que l'app ; Apps Script répond par une redirection que urllib suit.
            req = urllib.request.Request(self.url, data=body, method="POST", headers={"Content-Type": "text/plain;charset=utf-8"})
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    res = json.loads(r.read() or b"{}")
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
                if attempt < 4:
                    time.sleep(2 ** attempt)
                    continue
                raise SystemExit(f"Apps Script injoignable : {e}")
            if not res.get("ok"):
                raise SystemExit(f"Apps Script a refusé l'import : {res.get('error')}")
            return res
        raise SystemExit("Apps Script : trop de tentatives")

    def import_file(self, kind: str, path: Path) -> None:
        if not path.exists():
            log.warning("Fichier %s absent : %s", kind, path)
            return
        rows = to_rows(kind, read_csv(path, COLS[kind]))
        if not rows:
            log.warning("%s : aucune ligne exploitable", path.name)
            return
        unknown: list[str] = []
        for i in range(0, len(rows), CHUNK):
            res = self.call({"kind": kind, "rows": rows[i:i + CHUNK], "first": i == 0, "last": i + CHUNK >= len(rows), "total": len(rows)})
            unknown = res.get("unknown") or unknown
        log.info("%s : %d lignes importées", kind, len(rows))
        if unknown:
            log.warning("%s : sites Sage sans loja correspondante (vérifier « Sage » dans Bastidor → Configuração) : %s", kind, ", ".join(unknown))


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler(HERE / "import_sage.log", encoding="utf-8")])
    cfg = load_config()
    app = AppsScript(cfg["url"], cfg["import_key"])
    folder = Path(cfg["dossier_csv"])
    app.import_file("stock", folder / cfg.get("fichier_stock", "stock.csv"))
    app.import_file("shipments", folder / cfg.get("fichier_expedicoes", "expedicoes.csv"))
    kpi = folder / cfg.get("fichier_kpis", "kpis.csv")
    if kpi.exists():
        app.import_file("kpis", kpi)
    log.info("Import terminé.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
