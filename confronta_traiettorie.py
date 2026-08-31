#!/usr/bin/env python3
"""Confronta le sfere di Bloch esatte con quelle campionate per traiettorie.

La vista di Bloch sotto rumore evolve oggi la matrice densita' completa dei 12
qubit: 4096x4096, ~268 MB di solo stato, e su una CPU sola 122-137 secondi.
Ma le sfere mostrano solo le ridotte 1-qubit, cioe' matrici 2x2.

Le stesse ridotte si ottengono campionando traiettorie sullo statevector (65 KB)
e mediando: Aer applica i canali Kraus scegliendone uno per traiettoria. Il
prezzo e' un errore statistico che scende come 1/sqrt(shots).

Questo script misura quel prezzo contro la verita' esatta gia' disponibile in
precomputed/bloch.json, cosi' la decisione di sostituire o no si prende sui
numeri e non a sentimento.

Uso:  python confronta_traiettorie.py [--shots 200,500,1000,2000]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import api_backend as api
from experiment_backend import (
    BASIS_GATES,
    SEED_TRANSPILER,
    build_illustrative_noise_model,
    noise_is_active,
)

N = 15


def bloch_da_rho(rho):
    import numpy as np
    r = np.asarray(rho)
    return (float(2 * r[0, 1].real), float(-2 * r[0, 1].imag), float((r[0, 0] - r[1, 1]).real))


def circuito_per_stadi(n_count: int):
    """Lo stesso circuito composto per tratti che usa la vista esatta."""
    from qiskit import QuantumCircuit, transpile

    base = api._instance_circuit(N)
    stages = api._instance_stages(N)
    full = QuantumCircuit(base.num_qubits)
    start = 0
    for index, stage in enumerate(stages):
        chunk = QuantumCircuit(base.num_qubits)
        for inst in base.data[start:stage["end"]]:
            if inst.operation.name.lower() in ("barrier", "measure"):
                continue
            chunk.append(inst.operation, inst.qubits)
        start = stage["end"]
        if chunk.data:
            full.compose(transpile(chunk, basis_gates=BASIS_GATES, optimization_level=2,
                                   seed_transpiler=SEED_TRANSPILER), inplace=True)
        for q in range(n_count):
            full.save_density_matrix(qubits=[q], label=f"s{index}q{q}")
    return full, len(stages)


def esegui(metodo: str, noise: dict, shots: int | None, seed: int = 7):
    from qiskit_aer import AerSimulator

    n_count = api.instance_config(N)["n_count"]
    full, n_stadi = circuito_per_stadi(n_count)
    model = build_illustrative_noise_model(noise) if noise_is_active(noise) else None
    sim = AerSimulator(method=metodo, noise_model=model)
    t0 = time.time()
    if shots:
        data = sim.run(full, shots=shots, seed_simulator=seed).result().data()
    else:
        data = sim.run(full).result().data()
    durata = time.time() - t0
    vettori = [[bloch_da_rho(data[f"s{i}q{q}"]) for q in range(n_count)] for i in range(n_stadi)]
    return vettori, durata


def confronta(esatti, campionati):
    """Errore massimo e medio sulle componenti, e sulla lunghezza |r|."""
    import math

    peggiore = 0.0
    somma = 0.0
    n = 0
    peggiore_r = 0.0
    for st_e, st_c in zip(esatti, campionati):
        for ve, vc in zip(st_e, st_c):
            for a, b in zip(ve, vc):
                d = abs(a - b)
                peggiore = max(peggiore, d)
                somma += d
                n += 1
            re_ = math.sqrt(sum(x * x for x in ve))
            rc = math.sqrt(sum(x * x for x in vc))
            peggiore_r = max(peggiore_r, abs(re_ - rc))
    return {"max": peggiore, "medio": somma / max(1, n), "max_len": peggiore_r, "componenti": n}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shots", default="200,500,1000,2000")
    args = parser.parse_args()
    lista = [int(x) for x in args.shots.split(",")]

    preset = {
        "ideale": {},
        "uc1": {"eps_1q": 0.001, "eps_2q": 0.01, "t1_us": 100.0, "t2_us": 80.0,
                "readout_0to1": 0.0, "readout_1to0": 0.0, "coherent_overrotation_deg": 0.0},
        "uc2": {"eps_1q": 0.005, "eps_2q": 0.05, "t1_us": 50.0, "t2_us": 30.0,
                "readout_0to1": 0.0, "readout_1to0": 0.0, "coherent_overrotation_deg": 0.0},
    }

    for nome, rumore in preset.items():
        cfg = api.normalise_noise_config(rumore)
        print(f"\n=== {nome} ===", flush=True)
        esatti, t_esatto = esegui("density_matrix", cfg, None)
        print(f"  esatto (matrice densita'): {t_esatto:6.1f} s", flush=True)
        for shots in lista:
            camp, t_camp = esegui("statevector", cfg, shots)
            e = confronta(esatti, camp)
            print(f"  traiettorie shots={shots:<5} {t_camp:6.1f} s   "
                  f"errore max {e['max']:.4f}  medio {e['medio']:.4f}  su |r| {e['max_len']:.4f}",
                  flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
