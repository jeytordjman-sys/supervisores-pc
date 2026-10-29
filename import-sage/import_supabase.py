"""
Import nocturne Sage X3 -> base Supabase de l'app « Supervisores P&C ».

Lit les CSV déposés par l'informatique et les écrit directement dans les tables
stock / shipments / kpis via l'API REST de Supabase (clé service_role, jamais
exposée dans l'app) :
- Stock       : remplacement complet (le fichier = l'état du jour).
- Expéditions : remplacement complet (fenêtre glissante 30 jours).
- KPI mensuels (optionnel) : mise à jour par site + mois.
Une ligne est ajoutée dans « imports » (visible dans Bastidor → Painel).

Aucune dépendance hors bibliothèque standard Python 3.9+.
Configuration : config.ini à côté de ce script, section [supabase] (voir config.example.ini).
Planification : Planificateur de tâches Windows (installer_tache_nocturne.ps1, en
remplaçant import_sage.py par import_supabase.py).
"""
from __future__ import annotations

import configparser
import json
import logging
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from import_sage import COLS, read_csv, parse_bool, parse_date, parse_int, parse_num, parse_status

HERE = Path(__file__).resolve().parent
CHUNK = 500
log = logging.getLogger("import_supabase")


def load_config() -> configparser.SectionProxy:
    cfg = configparser.ConfigParser()
    path = HERE / "config.ini"
    if not path.exists():
        sys.exit(f"config.ini introuvable ({path}). Copier config.example.ini -> config.ini et le remplir.")
    cfg.read(path, encoding="utf-8")
    if "supabase" not in cfg:
        sys.exit("config.ini : section [supabase] manquante (url, service_role_key, dossier_csv).")
    return cfg["supabase"]


def to_rows(kind: str, raw: list[dict]) -> list[dict]:
    rows: list[dict] = []
    for r in raw:
        if kind == "stock":
            if not r["Site"].strip() or not r["Referencia"].strip():
                continue
            rows.append({"site": r["Site"].strip().upper(), "ref": r["Referencia"].strip(), "des": r["Designacao"].strip(),
                         "qty": parse_int(r["QtdStock"]), "last": parse_date(r["DataUltimaVenda"]), "top": parse_bool(r["TopVenda"])})
        elif kind == "shipments":
            if not r["NumExpedicao"].strip():
                continue
            rows.append({"no": r["NumExpedicao"].strip(), "site": r["SiteDestino"].strip().upper(), "date": parse_date(r["DataEnvio"]),
                         "lines": parse_int(r["NbLinhas"]), "sent": parse_int(r["QtdEnviada"]), "recv": parse_int(r["QtdRecebida"]),
                         "status": parse_status(r["Estado"])})
        else:
            month = parse_date(r["Mes"])
            if not r["Site"].strip() or not month:
                continue
            traffic, tickets = parse_num(r["Trafego"]), parse_num(r["Tickets"])
            rows.append({"site": r["Site"].strip().upper(), "month": month[:7], "sales": parse_num(r["Vendas"]) or 0,
                         "target": parse_num(r["Objetivo"]) or 0,
                         "traffic": int(traffic) if traffic is not None else None, "tickets": int(tickets) if tickets is not None else None})
    return rows


class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/") + "/rest/v1/"
        self.h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def call(self, method: str, path: str, body=None, prefer: str = "") -> list | dict:
        data = json.dumps(body).encode() if body is not None else None
        headers = dict(self.h)
        if prefer:
            headers["Prefer"] = prefer
        for attempt in range(5):
            req = urllib.request.Request(self.url + path, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    raw = r.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                    time.sleep(2 ** attempt)
                    continue
                raise SystemExit(f"Supabase {e.code} sur {path}: {text}")
        raise SystemExit("Supabase : trop de tentatives")

    def replace(self, table: str, rows: list[dict], key_col: str) -> None:
        self.call("DELETE", f"{table}?{key_col}=neq.%00")
        for i in range(0, len(rows), CHUNK):
            self.call("POST", table, rows[i:i + CHUNK], prefer="return=minimal")

    def upsert(self, table: str, rows: list[dict]) -> None:
        for i in range(0, len(rows), CHUNK):
            self.call("POST", table, rows[i:i + CHUNK], prefer="resolution=merge-duplicates,return=minimal")

    def known_sites(self) -> set[str]:
        return {s["code"].upper() for s in self.call("GET", "stores?select=code")}

    def import_file(self, kind: str, path: Path) -> None:
        if not path.exists():
            log.warning("Fichier %s absent : %s", kind, path)
            return
        rows = to_rows(kind, read_csv(path, COLS[kind]))
        if not rows:
            log.warning("%s : aucune ligne exploitable", path.name)
            return
        if kind == "stock":
            self.replace("stock", rows, "site")
        elif kind == "shipments":
            self.replace("shipments", rows, "no")
        else:
            self.upsert("kpis", rows)
        unknown = sorted({r["site"] for r in rows} - self.known_sites())
        self.call("POST", "imports", {
            "id": int(time.time() * 1000) * 1000 + random.randint(0, 999),
            "kind": {"stock": "Stock", "shipments": "Expedições", "kpis": "KPI"}[kind],
            "at": datetime.now(timezone.utc).isoformat(), "rows": len(rows), "unknown": unknown,
        }, prefer="return=minimal")
        log.info("%s : %d lignes importées", kind, len(rows))
        if unknown:
            log.warning("%s : sites Sage sans loja correspondante (vérifier « Código Sage ») : %s", kind, ", ".join(unknown))


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler(HERE / "import_sage.log", encoding="utf-8")])
    cfg = load_config()
    db = Supabase(cfg["url"], cfg["service_role_key"])
    folder = Path(cfg["dossier_csv"])
    db.import_file("stock", folder / cfg.get("fichier_stock", "stock.csv"))
    db.import_file("shipments", folder / cfg.get("fichier_expedicoes", "expedicoes.csv"))
    kpi = folder / cfg.get("fichier_kpis", "kpis.csv")
    if kpi.exists():
        db.import_file("kpis", kpi)
    log.info("Import terminé.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
