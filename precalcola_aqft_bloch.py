#!/usr/bin/env python3
"""Precalcola le sfere di Bloch stadio per stadio del circuito AQFT.

Ogni voce e' una matrice densita' a 12 qubit simulata per tratti (circa un minuto su una
CPU sola): tutti i gradi da k=1 a k=7 (QFT piena), senza rumore e con i preset UC1 e UC2.
Cosi' la vista stadio per stadio non fa mai aspettare chi muove il cursore. Il preset
"Solo readout" non serve: il readout non cambia lo stato, quindi coincide con il caso
senza rumore.

Uso:  python precalcola_aqft_bloch.py
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import aqft_backend as aqft  # noqa: E402
from experiment_backend import run_bloch_isolated  # noqa: E402

USCITA = os.path.join(HERE, "precomputed", "aqft_bloch.json")
PRESET = {
    "ideale": {},
    "uc1": {"eps_1q": 0.001, "eps_2q": 0.01, "t1_us": 100.0, "t2_us": 80.0},
    "uc2": {"eps_1q": 0.005, "eps_2q": 0.05, "t1_us": 50.0, "t2_us": 30.0},
}


def main() -> int:
    voci, indice = {}, []
    for k in aqft.K_VALUES:
        for nome, rumore in PRESET.items():
            porte = aqft._rumore_sulle_porte(rumore)
            risultato = run_bloch_isolated(N=aqft.N_AQFT, noise=porte, k=k)
            firma = aqft._firma_bloch(k, porte)
            voci[firma] = risultato
            indice.append({"k": k, "preset": nome, "firma": firma})
            qft = next(s for s in risultato["stages"] if s["kind"] == "qft")
            print(f"k={k} {nome:7s} |r| dopo la QFT: "
                  + " ".join(f"{q['len']:.3f}" for q in qft["qubits"]), flush=True)
    documento = {
        "schema_version": "1.0",
        "generato": _dt.datetime.now().isoformat(timespec="seconds"),
        "nota": "Matrice densita' esatta per tratti, readout escluso (non cambia lo stato).",
        "indice": indice,
        "voci": voci,
    }
    with open(USCITA, "w", encoding="utf-8") as fh:
        json.dump(documento, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"Scritto {os.path.relpath(USCITA, HERE)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
