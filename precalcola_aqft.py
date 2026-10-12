#!/usr/bin/env python3
"""Precalcola la resa in fattori contro il grado dell'AQFT sotto i preset illustrativi.

La curva serve a mostrare dove sta l'ottimo senza far aspettare l'utente: sette gradi per
tre preset sono decine di secondi di Aer, e i numeri non cambiano fra un avvio e l'altro.
L'esperimento live della scheda resta per il singolo grado scelto.

Ogni punto porta seed, shot e intervallo di Wilson. Il modello e' lo stesso uniforme e
illustrativo del laboratorio del rumore: NON e' la campagna M15 della tesi, che usa una
snapshot FakeSherbrooke con porte ECR. Per i numeri citabili si veda estrai_dati_aqft.py.

Uso:  python precalcola_aqft.py [--shots 4096] [--seed 42]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import importlib.metadata
import json
import os
import platform
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import aqft_backend as aqft  # noqa: E402
from api_backend import _analyse_memory, _wilson_interval, normalise_noise_config  # noqa: E402
from experiment_backend import build_illustrative_noise_model  # noqa: E402

USCITA = os.path.join(HERE, "precomputed", "aqft_curva.json")
SEED_STEP = 10_007

# Gli stessi canali dei preset di frontend/app.js, come li applica applyPreset.
PRESET = {
    # Come il laboratorio: il preset "Solo readout" spegne anche T1/T2 (app.js, applyPreset).
    "readout": {"eps_1q": 0.0, "eps_2q": 0.0, "t1_us": None, "t2_us": None,
                "readout_0to1": 0.02, "readout_1to0": 0.02, "coherent_overrotation_deg": 0.0},
    "uc1": {"eps_1q": 0.001, "eps_2q": 0.01, "t1_us": 100.0, "t2_us": 80.0,
            "readout_0to1": 0.02, "readout_1to0": 0.02, "coherent_overrotation_deg": 0.0},
    "uc2": {"eps_1q": 0.005, "eps_2q": 0.05, "t1_us": 50.0, "t2_us": 30.0,
            "readout_0to1": 0.05, "readout_1to0": 0.05, "coherent_overrotation_deg": 0.0},
}


def versione(nome: str) -> str | None:
    try:
        return importlib.metadata.version(nome)
    except importlib.metadata.PackageNotFoundError:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--shots", type=int, default=4096)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.shots >= SEED_STEP:
        parser.error(f"--shots deve essere < {SEED_STEP}: oltre, i flussi di seed dei punti si sovrappongono.")

    from qiskit_aer import AerSimulator

    struttura = aqft.aqft_structure()
    preset_out = {}
    for i, (nome, rumore) in enumerate(PRESET.items()):
        config = normalise_noise_config(rumore)
        simulatore = AerSimulator(noise_model=build_illustrative_noise_model(config),
                                  method="matrix_product_state")
        punti = []
        for k in aqft.K_VALUES:
            # Aer usa seed + i per lo shot i: due punti sono indipendenti solo se i loro
            # intervalli [seed, seed + shot) non si sovrappongono. Passo 10 007 > shot massimi.
            seme = args.seed + SEED_STEP * (len(aqft.K_VALUES) * i + (k - 1))
            memoria = simulatore.run(aqft.compiled_circuit(k), shots=args.shots,
                                     seed_simulator=seme, memory=True).result().get_memory()
            analisi = _analyse_memory(aqft._normalise_memory(memoria), aqft.N_AQFT)
            punti.append({
                "k": k,
                "seed": seme,
                "shots": analisi["shots"],
                "successes": analisi["n_ok"],
                "factor_yield": round(analisi["factor_yield"], 6),
                "wilson_ci": {x: round(v, 6) for x, v in
                              _wilson_interval(analisi["n_ok"], analisi["shots"]).items()},
                "peak_mass": round(analisi["peak_mass"], 6),
            })
            print(f"{nome:8s} k={k}  P={analisi['factor_yield']:.4f}  "
                  f"[{punti[-1]['wilson_ci']['low']:.4f}; {punti[-1]['wilson_ci']['high']:.4f}]",
                  flush=True)
        migliore = max(punti, key=lambda p: p["factor_yield"])
        preset_out[nome] = {"noise": config, "points": punti, "best_k": migliore["k"]}

    documento = {
        "schema_version": "1.0",
        "generato": _dt.datetime.now().isoformat(timespec="seconds"),
        "nota": ("Modello uniforme illustrativo della demo, non la campagna M15. Il grado "
                 "migliore e' scelto sugli stessi dati che lo stimano: e' un'indicazione "
                 "visiva, non una selezione con holdout."),
        "N": aqft.N_AQFT, "a": aqft.A_AQFT, "n_count": aqft.N_COUNT, "k_full": aqft.K_FULL,
        "shots_per_point": args.shots,
        "seed_base": args.seed,
        "seed_rule": f"seed = seed_base + {SEED_STEP} * (7 * indice_preset + k - 1)",
        "seed_step": SEED_STEP,
        "random_factor_floor": struttura["random_factor_floor"],
        "ideal_factor_yield": struttura["degrees"][-1]["ideal"]["factor_yield"],
        "versions": {"python": platform.python_version(), "qiskit": versione("qiskit"),
                     "qiskit_aer": versione("qiskit-aer")},
        "basis_gates": struttura["basis_gates"],
        "seed_transpiler": struttura["seed_transpiler"],
        "full_circuit_sha256": struttura["full_circuit_check"]["sha256"],
        "presets": preset_out,
    }
    os.makedirs(os.path.dirname(USCITA), exist_ok=True)
    with open(USCITA, "w", encoding="utf-8") as fh:
        json.dump(documento, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"Scritto {os.path.relpath(USCITA, HERE)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
