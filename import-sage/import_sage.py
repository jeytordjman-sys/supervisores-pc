"""
Import nocturne Sage X3 -> app « Supervisores P&C » (Floot).

Lit les 2 fichiers CSV déposés par l'informatique dans un dossier partagé et
les envoie à l'app par son API d'import, par paquets de 400 lignes :
- Stock       : remplacement complet (le fichier = l'état du jour).
- Expéditions : mise à jour par N° d'expédition, puis purge des expéditions
                absentes du fichier (fenêtre glissante 30 jours).
- KPI mensuels (optionnel, fichier kpis.csv) : mise à jour par site + mois.

Aucune dépendance hors bibliothèque standard Python 3.9+.
Configuration : config.ini à côté de ce script (voir config.example.ini).
Planification : Planificateur de tâches Windows (installer_tache_nocturne.ps1).
"""
from __future__ import annotations

import configparser
import csv
import json
import logging
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHUNK = 400

COLS = {
    "stock": ["Site", "Referencia", "Designacao", "QtdStock", "DataUltimaVenda", "TopVenda"],
    "shipments": ["NumExpedicao", "SiteDestino", "DataEnvio", "NbLinhas", "QtdEnviada", "QtdRecebida", "Estado"],
    "kpis": ["Site", "Mes", "Vendas", "Objetivo", "Trafego", "Tickets"],
}

log = logging.getLogger("import_sage")


# --------------------------------------------------------------------------- utils
def load_config() -> configparser.SectionProxy:
    cfg = configparser.ConfigParser()
    path = HERE / "config.ini"
    if not path.exists():
        sys.exit(f"config.ini introuvable ({path}). Copier config.example.ini -> config.ini et le remplir.")
    cfg.read(path, encoding="utf-8")
    return cfg["app"]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").strip().lower())
    return "".join(ch for ch in s if ch.isalnum())


def parse_date(raw: str) -> str | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y%m%d", "%d.%m.%Y", "%Y-%m"):
        try:
            d = datetime.strptime(raw[:10] if fmt != "%Y-%m" else raw[:7], fmt)
            return d.date().isoformat()
        except ValueError:
            continue
    log.warning("Date non reconnue : %r", raw)
    return None


def parse_num(raw: str) -> float | None:
    raw = (raw or "").strip().replace(" ", "").replace(" ", "").replace(",", ".")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        log.warning("Nombre non reconnu : %r", raw)
        return None


def parse_int(raw: str) -> int:
    n = parse_num(raw)
    return int(round(n)) if n is not None else 0


def parse_bool(raw: str) -> bool:
    return (raw or "").strip().lower() in {"o", "oui", "s", "sim", "y", "yes", "1", "true", "x"}


def parse_status(raw: str) -> str:
    n = _norm(raw)
    if n.startswith(("rece", "recu")) or n == "r":
        return "received"
    if n.startswith(("dif", "ecart")) or n == "d":
        return "discrepancy"
    return "in_transit"


def read_csv(path: Path, expected: list[str]) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        reader = csv.DictReader(f, dialect=dialect)
        norm = {h: _norm(h) for h in reader.fieldnames or []}
        wanted = {_norm(c): c for c in expected}
        missing = [c for n, c in wanted.items() if n not in norm.values()]
        if missing:
            sys.exit(f"{path.name} : colonnes manquantes {missing}. En-têtes lus : {reader.fieldnames}")
        return [{wanted[norm[h]]: v for h, v in r.items() if h in norm and norm[h] in wanted} for r in reader]


def to_rows(kind: str, raw: list[dict]) -> list[dict]:
    rows = []
    for r in raw:
        if kind == "stock":
            if not r["Site"].strip() or not r["Referencia"].strip():
                continue
            rows.append({
                "site": r["Site"].strip(), "reference": r["Referencia"].strip(), "designation": r["Designacao"].strip(),
                "qty": parse_int(r["QtdStock"]), "lastSaleDate": parse_date(r["DataUltimaVenda"]), "topSeller": parse_bool(r["TopVenda"]),
            })
        elif kind == "shipments":
            if not r["NumExpedicao"].strip():
                continue
            rows.append({
                "shipmentNo": r["NumExpedicao"].strip(), "site": r["SiteDestino"].strip(), "sentDate": parse_date(r["DataEnvio"]),
                "lineCount": parse_int(r["NbLinhas"]), "qtySent": parse_int(r["QtdEnviada"]), "qtyReceived": parse_int(r["QtdRecebida"]),
                "status": parse_status(r["Estado"]),
            })
        else:
            month = parse_date(r["Mes"])
            if not r["Site"].strip() or not month:
                continue
            traffic, tickets = parse_num(r["Trafego"]), parse_num(r["Tickets"])
            rows.append({
                "site": r["Site"].strip(), "month": month[:7] + "-01", "sales": parse_num(r["Vendas"]), "salesTarget": parse_num(r["Objetivo"]),
                "traffic": int(traffic) if traffic is not None else None, "tickets": int(tickets) if tickets is not None else None,
            })
    return rows


# --------------------------------------------------------------------------- API
class App:
    def __init__(self, base_url: str, import_key: str):
        self.url = base_url.rstrip("/") + "/_api/import/rows"
        self.h = {"Content-Type": "application/json", "x-import-key": import_key}

    def send(self, kind: str, rows: list[dict], replace: bool, final: bool) -> dict:
        body = json.dumps({"json": {"kind": kind, "rows": rows, "replace": replace, "final": final, "source": "script"}}).encode()
        for attempt in range(5):
            req = urllib.request.Request(self.url, data=body, method="POST", headers=self.h)
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    return json.loads(r.read() or b"{}").get("json", {})
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                if e.code in (429, 500, 502, 503) and attempt < 4:
                    time.sleep(2 ** attempt)
                    continue
                raise SystemExit(f"API {e.code}: {text}")
        raise SystemExit("API : trop de tentatives")

    def import_file(self, kind: str, path: Path) -> None:
        if not path.exists():
            log.warning("Fichier %s absent : %s", kind, path)
            return
        rows = to_rows(kind, read_csv(path, COLS[kind]))
        if not rows:
            log.warning("%s : aucune ligne exploitable", path.name)
            return
        unknown: set[str] = set()
        for i in range(0, len(rows), CHUNK):
            res = self.send(kind, rows[i:i + CHUNK], replace=(i == 0), final=(i + CHUNK >= len(rows)))
            unknown.update(res.get("unknownSites", []))
        log.info("%s : %d lignes importées", kind, len(rows))
        if unknown:
            log.warning("%s : sites Sage sans magasin correspondant (vérifier « Código Sage » des lojas) : %s", kind, ", ".join(sorted(unknown)))


# --------------------------------------------------------------------------- main
def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler(HERE / "import_sage.log", encoding="utf-8")])
    cfg = load_config()
    app = App(cfg["url"], cfg["import_key"])
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
