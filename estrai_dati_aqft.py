#!/usr/bin/env python3
"""Estrae dagli artefatti M15 della tesi i risultati AQFT che la demo mostra.

Come ``estrai_dati_tesi.py``: la demo non ricalcola le campagne, ne legge gli output e li
riduce a pochi numeri con la loro provenienza (file, SHA-256 del file, shot, seed). Un
numero senza provenienza non e' citabile.

Sorgenti, tutte in ``Extra/experiments/M15_qft_topologia/artifacts``:
  N=15   pilota FakeSherbrooke, griglia k_QPE 1..7, selezione su train e holdout disgiunto
  N=21   sensibilita' al rumore (fattori 0,03 / 0,01 / 0,003), QFT piena contro k_arith=1
  M15b   stima di fase isolata, 9 contrasti preregistrati

Il contrasto N=21 a troncamento fisso (k_arith=1) e' ricalcolato dai conteggi holdout con
la stessa funzione ``newcombe_diff_ci`` di ``qft_approssimata.py``: e' la tabella del README
di M15, non il contrasto primario di selezione, che su N=21 sceglie sempre la QFT piena.

Uso:  python estrai_dati_aqft.py
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TESI = os.path.abspath(os.path.join(HERE, "..", ".."))
BASE = "Extra/experiments/M15_qft_topologia/artifacts"
USCITA = os.path.join(HERE, "precomputed", "aqft_tesi.json")

SORGENTI = {
    "n15": f"{BASE}/v1_20260830/results_M15_qft_N15_v1_20260830_151350.json",
    "n21": [
        f"{BASE}/sensibilita/results_M15_qft_N21_v1_20260831_135104.json",
        f"{BASE}/sensibilita/results_M15_qft_N21_v1_20260831_144129.json",
        f"{BASE}/sensibilita/results_M15_qft_N21_v1_20260831_152704.json",
    ],
    "qpe": f"{BASE}/benchmark/results_M15b_qpe_v1_20260831_163523.json",
}


def leggi(relativo: str) -> tuple[dict, dict]:
    percorso = os.path.join(TESI, relativo)
    if not os.path.exists(percorso):
        raise SystemExit(f"Sorgente mancante: {percorso}")
    with open(percorso, "rb") as fh:
        grezzo = fh.read()
    fonte = {"file": relativo, "sha256": hashlib.sha256(grezzo).hexdigest()}
    return json.loads(grezzo.decode("utf-8")), fonte


def r(x, cifre=6):
    return None if x is None else round(float(x), cifre)


def newcombe_diff_ci(s1, n1, s2, n2, z=1.959963985):
    """Copia di ``qft_approssimata.newcombe_diff_ci``: stessa convenzione di M13."""
    def wilson(s, n):
        if n == 0:
            return 0.0, 0.0
        p = s / n
        d = 1.0 + z * z / n
        centro = (p + z * z / (2 * n)) / d
        mezzo = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
        return max(0.0, centro - mezzo), min(1.0, centro + mezzo)

    l1, u1 = wilson(s1, n1)
    l2, u2 = wilson(s2, n2)
    diff = s1 / n1 - s2 / n2
    basso = diff - ((s1 / n1 - l1) ** 2 + (u2 - s2 / n2) ** 2) ** 0.5
    alto = diff + ((u1 - s1 / n1) ** 2 + (s2 / n2 - l2) ** 2) ** 0.5
    return float(diff), float(max(-1.0, basso)), float(min(1.0, alto))


def estrai_n15() -> dict:
    doc, fonte = leggi(SORGENTI["n15"])
    a = doc["analysis"]
    griglia = []
    for p in doc["points"]:
        if p.get("elimina_swap"):
            continue  # braccio senza SWAP: identico cifra per cifra, documentato come nullo
        griglia.append({
            "k": p["k_qpe"],
            "is_full": bool(p.get("is_riferimento")),
            "ecr": p["n_ecr"],
            "depth": p["depth"],
            "holdout": r(p["holdout"]["P_success"]),
            "holdout_successes": p["holdout"]["successes"],
            "holdout_shots": p["holdout"]["shots"],
            "train": r(p["train"]["P_success"]),
        })
    griglia.sort(key=lambda x: x["k"])
    c = a["primary_contrast"]
    return {
        "fonte": fonte,
        "schema_version": doc.get("schema_version"),
        "timestamp": doc.get("timestamp"),
        "seed": doc.get("seed"),
        "shots": doc["config"]["shots"],
        "batches": doc["config"]["batches"],
        "holdout_fraction": doc["config"]["holdout_fraction"],
        "backend": doc.get("backend", {}).get("name"),
        "calibration_sha256": doc.get("backend", {}).get("calibration_sha256"),
        "canonical_circuit_sha256": doc.get("canonical_circuit_sha256"),
        "basis": ["sx", "rz", "x", "ecr"],
        "rule": a["preregistered_rule"],
        "selected_k": a["selected_on_train"]["k_qpe"],
        "selected_holdout": r(a["selected_holdout"]["P_success"]),
        "full_holdout": r(a["reference_full_qft_holdout"]["P_success"]),
        "contrast": {"difference": r(c["difference"]), "low": r(c["ci_low"]),
                     "high": r(c["ci_high"]), "method": c["method"]},
        "ecr": a["ecr_reduction"],
        "degenerate_caveat": bool(a.get("caveat_N15_degenerate")),
        "grid": griglia,
    }


def estrai_n21() -> dict:
    righe, fonti, ecr = [], [], None
    for relativo in SORGENTI["n21"]:
        doc, fonte = leggi(relativo)
        fonti.append(fonte)
        piena = next(p for p in doc["points"] if p.get("is_riferimento"))
        tronca = next(p for p in doc["points"]
                      if p["k_qpe"] == 7 and p["k_arith"] == 1 and not p.get("elimina_swap"))
        hp, ht = piena["holdout"], tronca["holdout"]
        diff, lo, hi = newcombe_diff_ci(ht["successes"], ht["shots"], hp["successes"], hp["shots"])
        ecr = {"full": piena["n_ecr"], "truncated": tronca["n_ecr"],
               "depth_full": piena["depth"], "depth_truncated": tronca["depth"]}
        righe.append({
            "noise_factor": doc["config"]["fattore_rumore"],
            "full_holdout": r(hp["P_success"]), "truncated_holdout": r(ht["P_success"]),
            "shots_per_arm": hp["shots"],
            "contrast": {"difference": r(diff), "low": r(lo), "high": r(hi)},
            "selected_on_train": doc["analysis"]["selected_on_train"],
        })
    righe.sort(key=lambda x: -x["noise_factor"])
    return {
        "fonti": fonti,
        "truncation": "k_arith = 1 (QFT interne agli addizionatori), k_QPE = 7",
        "ecr": ecr,
        "rows": righe,
        "random_factor_floor": 65 / 256,
    }


def estrai_qpe() -> dict:
    doc, fonte = leggi(SORGENTI["qpe"])
    contrasti = [{
        "n": c["n_count"], "phase": c["fase"], "representable": bool(c["rappresentabile"]),
        "k_selected": c["k_scelto"], "k_full": c["k_pieno"],
        "aqft": r(c["holdout_scelto"]), "full": r(c["holdout_pieno"]),
        "difference": r(c["difference"]), "low": r(c["ci_low"]), "high": r(c["ci_high"]),
        "ecr_saved": c["ecr_risparmiate"],
    } for c in doc["analysis"]["contrasts"]]
    return {
        "fonte": fonte,
        "shots": doc["config"]["shots"],
        "batches": doc["config"]["batches"],
        "rule": doc["analysis"]["preregistered_rule"],
        "metric": doc["analysis"]["metric"],
        "contrasts": contrasti,
        "positive": sum(1 for c in contrasti if c["difference"] > 0),
        "excluding_zero": sum(1 for c in contrasti if c["low"] > 0),
    }


def main() -> int:
    documento = {
        "schema_version": "1.0",
        "generato": _dt.datetime.now().isoformat(timespec="seconds"),
        "nota": ("Risultati M15 estratti dagli artefatti della tesi, non ricalcolati. Rumore da "
                 "snapshot FakeSherbrooke, base sx/rz/x/ecr: non confrontabili cifra per cifra "
                 "con il modello uniforme della demo."),
        "n15": estrai_n15(),
        "n21": estrai_n21(),
        "qpe": estrai_qpe(),
    }
    os.makedirs(os.path.dirname(USCITA), exist_ok=True)
    with open(USCITA, "w", encoding="utf-8") as fh:
        json.dump(documento, fh, ensure_ascii=False, separators=(",", ":"))
    n15, n21, qpe = documento["n15"], documento["n21"], documento["qpe"]
    print(f"Scritto {os.path.relpath(USCITA, HERE)} ({os.path.getsize(USCITA) / 1024:.1f} KB)")
    print(f"  N=15: k scelto {n15['selected_k']}, holdout {n15['selected_holdout']} contro "
          f"{n15['full_holdout']}, diff {n15['contrast']['difference']} "
          f"[{n15['contrast']['low']}; {n15['contrast']['high']}], ECR {n15['ecr']}")
    for riga in n21["rows"]:
        c = riga["contrast"]
        print(f"  N=21 fattore {riga['noise_factor']}: piena {riga['full_holdout']} tronca "
              f"{riga['truncated_holdout']}  diff {c['difference']} [{c['low']}; {c['high']}]")
    print(f"  N=21 ECR {n21['ecr']}")
    print(f"  QPE: {qpe['positive']}/9 positivi, {qpe['excluding_zero']} escludono lo zero")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
