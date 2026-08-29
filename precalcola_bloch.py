#!/usr/bin/env python3
"""Precalcola le sfere di Bloch dei preset e le congela in un JSON.

Perche' esiste. La vista di Bloch evolve la matrice densita' di 12 qubit: in
locale, con una quindicina di thread, sono ~10 secondi; su Render, che da' una
CPU sola, sono 122-137 secondi misurati. I preset pero' sono valori FISSI e noti
in anticipo, e il risultato e' deterministico -- e' algebra lineare, non un
campionamento. Ricalcolarli a ogni riavvio del container e' lavoro sprecato che
l'utente paga in attesa.

Questo script li calcola una volta e li scrive in `precomputed/bloch.json`, che
viaggia nell'immagine. A runtime `api_backend._noisy_bloch_cached` consulta quel
file prima di simulare: i preset diventano immediati e restano immediati anche
dopo un riavvio, dove la lru_cache in memoria si azzererebbe.

Non e' un'approssimazione: sono gli stessi identici numeri che uscirebbero dalla
simulazione live. Una configurazione non prevista (i cursori mossi a mano) non
si trova nel file e viene simulata come prima.

Uso:
    python precalcola_bloch.py                 # scrive precomputed/bloch.json
    python precalcola_bloch.py --verifica      # ricalcola e confronta, non scrive
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import api_backend as api
from experiment_backend import run_bloch_isolated

PRECOMPUTED_DIR = os.path.join(HERE, "precomputed")
PRECOMPUTED_FILE = os.path.join(PRECOMPUTED_DIR, "bloch.json")

N = 15

# Le tre evoluzioni distinte che il frontend puo' chiedere con i preset.
# "Solo readout" non compare: il readout agisce sull'esito della misura e non
# sullo stato, quindi il frontend riusa la vista ideale invece di simulare.
# I valori sono quelli di PRESETS in frontend/app.js; il readout e' azzerato
# perche' noisy_bloch lo azzera prima di simulare, ed e' su quella chiave
# azzerata che la cache viene interrogata.
PRESET_NOISE = {
    "ideale": {},
    "uc1": {
        "eps_1q": 0.001, "eps_2q": 0.01, "t1_us": 100.0, "t2_us": 80.0,
        "readout_0to1": 0.0, "readout_1to0": 0.0, "coherent_overrotation_deg": 0.0,
    },
    "uc2": {
        "eps_1q": 0.005, "eps_2q": 0.05, "t1_us": 50.0, "t2_us": 30.0,
        "readout_0to1": 0.0, "readout_1to0": 0.0, "coherent_overrotation_deg": 0.0,
    },
}


def chiave(noise: dict) -> str:
    """La stessa chiave che usera' il lookup a runtime.

    Deve derivare dalla configurazione NORMALIZZATA e con il readout azzerato,
    cioe' esattamente cio' che `noisy_bloch` passa a `_noisy_bloch_cached`.
    """
    config = api.normalise_noise_config(noise)
    quantistico = {**config, "readout_0to1": 0.0, "readout_1to0": 0.0}
    return api.firma_rumore(N, quantistico)


def versioni() -> dict:
    out = {"python": sys.version.split()[0]}
    for modulo in ("qiskit", "qiskit_aer", "numpy"):
        try:
            out[modulo] = __import__(modulo).__version__
        except Exception:
            out[modulo] = "non disponibile"
    return out


def calcola() -> dict:
    voci = {}
    for nome, noise in PRESET_NOISE.items():
        k = chiave(noise)
        print(f"  {nome:8s} -> calcolo…", flush=True)
        inizio = _dt.datetime.now()
        risultato = run_bloch_isolated(N=N, noise=api.normalise_noise_config(noise))
        durata = (_dt.datetime.now() - inizio).total_seconds()
        print(f"  {nome:8s}    fatto in {durata:.1f}s  (chiave {k[:16]}…)", flush=True)
        voci[k] = {"preset": nome, "noise": api.normalise_noise_config(noise),
                   "durata_calcolo_s": round(durata, 2), "risultato": risultato}
    return voci


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verifica", action="store_true",
                        help="ricalcola e confronta con il file esistente, senza scrivere")
    args = parser.parse_args()

    costo = api.circuit_cost(N)
    print(f"Precalcolo Bloch per N={N} ({costo['num_qubits']} qubit, profondita' {costo['depth']}).")
    voci = calcola()

    if args.verifica:
        if not os.path.exists(PRECOMPUTED_FILE):
            print("Nessun file da verificare.")
            return 1
        atteso = json.load(open(PRECOMPUTED_FILE, encoding="utf-8"))["voci"]
        differenze = 0
        for k, v in voci.items():
            if k not in atteso:
                print(f"  MANCA nel file: {v['preset']}")
                differenze += 1
            elif atteso[k]["risultato"] != v["risultato"]:
                print(f"  DIVERSO: {v['preset']}")
                differenze += 1
            else:
                print(f"  identico: {v['preset']}")
        print("Verifica superata." if differenze == 0 else f"{differenze} differenze.")
        return 0 if differenze == 0 else 1

    documento = {
        "schema_version": "1.0",
        "generato": _dt.datetime.now().isoformat(timespec="seconds"),
        "N": N,
        "circuito": {
            "num_qubits": costo["num_qubits"], "depth": costo["depth"],
            "basis_gates": costo["basis_gates"], "seed_transpiler": costo["seed_transpiler"],
            "counts": costo["counts"],
        },
        "versioni": versioni(),
        "nota": ("Valori esatti, non campionati: la simulazione della matrice densita' e' "
                 "deterministica. Rigenerare con precalcola_bloch.py se cambia il circuito, "
                 "il modello di rumore o la versione di Aer."),
        "voci": voci,
    }
    os.makedirs(PRECOMPUTED_DIR, exist_ok=True)
    with open(PRECOMPUTED_FILE, "w", encoding="utf-8") as fh:
        json.dump(documento, fh, ensure_ascii=False, separators=(",", ":"))
    dimensione = os.path.getsize(PRECOMPUTED_FILE)
    print(f"Scritto {os.path.relpath(PRECOMPUTED_FILE, HERE)} ({dimensione/1024:.1f} KB, "
          f"{len(voci)} configurazioni).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
