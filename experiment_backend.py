"""Motore isolato per gli esperimenti della demo Shor v3.

La demo pubblica espone tre istanze didattiche verificate: ``N=15,21,35``.
Base e numero di qubit di conteggio sono scelti esclusivamente dal server. Aer viene
eseguito in un sottoprocesso per non portare
eventuali crash nativi nel worker ASGI e, soprattutto, con ``memory=True``: la sequenza
degli shot restituita all'interfaccia e' quindi quella reale, non una ricostruzione casuale
dei conteggi aggregati.

Il modello e' volutamente uniforme e illustrativo.  Non pretende di riprodurre una QPU
specifica: non include coupling map, routing, drift o calibrazioni per singolo qubit.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import subprocess
import sys
import traceback
import uuid
from typing import Any

import numpy as np


N_FIXED = 15
A_FIXED = 7
N_COUNT_FIXED = 8
MAX_SHOTS = 2048
LARGE_INSTANCE_MAX_SHOTS = 128
INSTANCE_CONFIGS = {
    15: {
        "N": 15, "a": 7, "n_count": 8, "order": 4,
        "max_shots": MAX_SHOTS, "implementation": "n15-a7-textbook-orbit-v3",
    },
    21: {
        "N": 21, "a": 2, "n_count": 10, "order": 6,
        "max_shots": LARGE_INSTANCE_MAX_SHOTS,
        "implementation": "n21-a2-beauregard-validated-v3",
    },
    35: {
        "N": 35, "a": 6, "n_count": 12, "order": 2,
        "max_shots": LARGE_INSTANCE_MAX_SHOTS,
        "implementation": "n35-a6-beauregard-validated-v3",
    },
}
BASIS_GATES = ["rz", "sx", "x", "cx"]
SEED_TRANSPILER = 20260819
GATE_TIME_1Q_NS = 50.0
GATE_TIME_2Q_NS = 300.0
LOGGER = logging.getLogger(__name__)


class SimulationUnavailable(RuntimeError):
    """Errore pubblico e deliberatamente privo di dettagli interni del worker."""


def instance_config(N: int) -> dict[str, Any]:
    """Restituisce una copia della configurazione validata, senza accettare a/t dal client."""
    if type(N) is not int or N not in INSTANCE_CONFIGS:
        raise ValueError("N deve essere una delle istanze validate: 15, 21 oppure 35.")
    return dict(INSTANCE_CONFIGS[N])


def noise_is_active(config: dict[str, Any]) -> bool:
    return any(
        (
            float(config.get("eps_1q", 0.0)) > 0,
            float(config.get("eps_2q", 0.0)) > 0,
            config.get("t1_us") is not None,
            float(config.get("readout_0to1", 0.0)) > 0,
            float(config.get("readout_1to0", 0.0)) > 0,
            abs(float(config.get("coherent_overrotation_deg", 0.0))) > 0,
        )
    )


def _compose_errors(errors):
    combined = None
    for error in errors:
        if error is not None:
            combined = error if combined is None else combined.compose(error)
    return combined


def _rx_error(angle_rad: float):
    from qiskit_aer.noise import coherent_unitary_error

    half = angle_rad / 2.0
    unitary = np.array(
        [[math.cos(half), -1j * math.sin(half)],
         [-1j * math.sin(half), math.cos(half)]],
        dtype=complex,
    )
    return coherent_unitary_error(unitary)


def build_illustrative_noise_model(config: dict[str, Any]):
    """Costruisce il modello uniforme usato dal laboratorio del rumore.

    Tutto il circuito e' prima decomposto nella base ``rz/sx/x/cx``.  Gli errori 1Q
    vengono applicati alle porte fisiche ``sx/x`` e quelli 2Q a ogni CX. Le ``rz``
    sono trattate come aggiornamenti virtuali del frame, quindi senza durata o rumore.
    Se T1/T2 sono presenti, la durata illustrativa e' 50 ns per ``sx/x`` e 300 ns
    per una CX. La sovrarotazione 1Q e' modellata come RX(delta) dopo ``sx/x``;
    non viene inventata una "sovrarotazione CX" equivalente. Il readout usa due
    probabilita' distinte P(1|0) e P(0|1).
    """
    from qiskit_aer.noise import (
        NoiseModel,
        ReadoutError,
        depolarizing_error,
        thermal_relaxation_error,
    )

    model = NoiseModel()
    eps_1q = float(config.get("eps_1q", 0.0))
    eps_2q = float(config.get("eps_2q", 0.0))
    overrotation = math.radians(float(config.get("coherent_overrotation_deg", 0.0)))

    thermal_1q = thermal_2q = None
    if config.get("t1_us") is not None:
        t1_ns = float(config["t1_us"]) * 1_000.0
        t2_ns = float(config["t2_us"]) * 1_000.0
        thermal_1q = thermal_relaxation_error(t1_ns, t2_ns, GATE_TIME_1Q_NS)
        one_qubit_2q_time = thermal_relaxation_error(t1_ns, t2_ns, GATE_TIME_2Q_NS)
        thermal_2q = one_qubit_2q_time.tensor(one_qubit_2q_time)

    error_1q = _compose_errors(
        [
            depolarizing_error(eps_1q, 1) if eps_1q > 0 else None,
            thermal_1q,
            _rx_error(overrotation) if overrotation else None,
        ]
    )
    error_2q = _compose_errors(
        [
            depolarizing_error(eps_2q, 2) if eps_2q > 0 else None,
            thermal_2q,
        ]
    )
    if error_1q is not None:
        model.add_all_qubit_quantum_error(error_1q, ["sx", "x"])
    if error_2q is not None:
        model.add_all_qubit_quantum_error(error_2q, ["cx"])

    p_01 = float(config.get("readout_0to1", 0.0))
    p_10 = float(config.get("readout_1to0", 0.0))
    if p_01 > 0 or p_10 > 0:
        model.add_all_qubit_readout_error(
            ReadoutError([[1.0 - p_01, p_01], [p_10, 1.0 - p_10]])
        )
    return model


def _normalise_memory(memory: list[str], n_count: int) -> list[str]:
    """Aer puo' separare piu' registri con spazi; qui ne esiste uno da ``n_count`` bit."""
    clean = []
    for item in memory:
        bits = str(item).replace(" ", "")
        clean.append(bits.zfill(n_count)[-n_count:])
    return clean


def _circuit_metadata(circuit) -> dict[str, Any]:
    return {
        "num_qubits": int(circuit.num_qubits),
        "num_clbits": int(circuit.num_clbits),
        "depth": int(circuit.depth()),
        "size": int(circuit.size()),
        "gate_counts": {str(k): int(v) for k, v in circuit.count_ops().items()},
    }


def _simulate(payload: dict[str, Any]) -> dict[str, Any]:
    from qiskit import transpile
    from qiskit_aer import AerSimulator

    # Import locale: il worker resta autonomo quando viene lanciato per percorso assoluto.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import shor_general as sg

    shots = int(payload["shots"])
    seed = int(payload["seed"])
    noise = dict(payload["noise"])
    instance = instance_config(int(payload["N"]))
    N = instance["N"]
    a = instance["a"]
    n_count = instance["n_count"]
    if shots > instance["max_shots"]:
        raise ValueError(
            f"Per N={N} il massimo e' {instance['max_shots']} shot per esecuzione."
        )
    active = noise_is_active(noise)
    # Baseline e campione rumoroso devono essere riproducibili ma statisticamente
    # indipendenti: usare lo stesso seed in due simulatori con flussi RNG diversi
    # crea una correlazione opaca e rende scorretto l'IC Newcombe indipendente.
    noisy_seed = (seed + 1_000_003) % (2 ** 31)

    base = sg.build_circuit(N, a, n_count)
    # Decomposizione esplicita: nessuna CCX/CP opaca puo' sfuggire a eps_2q.
    transpiled = transpile(
        base,
        basis_gates=BASIS_GATES,
        optimization_level=2,
        seed_transpiler=SEED_TRANSPILER,
    )

    ideal_simulator = AerSimulator(method="matrix_product_state")
    ideal_result = ideal_simulator.run(
        transpiled,
        shots=shots,
        seed_simulator=seed,
        memory=True,
    ).result()
    ideal_memory = _normalise_memory(ideal_result.get_memory(), n_count)

    if active:
        noisy_simulator = AerSimulator(
            noise_model=build_illustrative_noise_model(noise),
            method="matrix_product_state",
        )
        noisy_result = noisy_simulator.run(
            transpiled,
            shots=shots,
            seed_simulator=noisy_seed,
            memory=True,
        ).result()
        noisy_memory = _normalise_memory(noisy_result.get_memory(), n_count)
    else:
        # Zero rumore significa davvero la stessa baseline, non un secondo campione casuale.
        noisy_memory = list(ideal_memory)

    return {
        "ok": True,
        "ideal_memory": ideal_memory,
        "noisy_memory": noisy_memory,
        "simulation_seeds": {
            "ideal": seed,
            "noisy": noisy_seed if active else None,
            "independent_streams": bool(active),
        },
        "circuit": {
            "base": _circuit_metadata(base),
            "transpiled": _circuit_metadata(transpiled),
            "basis_gates": list(BASIS_GATES),
            "seed_transpiler": SEED_TRANSPILER,
        },
    }


def run_pair_isolated(
    *, N: int = N_FIXED, shots: int, seed: int, noise: dict[str, Any],
    timeout_seconds: float | None = None
) -> dict[str, Any]:
    """Esegue baseline e run rumoroso senza propagare stderr/traceback al chiamante."""
    active = noise_is_active(noise)
    instance = instance_config(N)
    if type(shots) is not int or shots < 1 or shots > instance["max_shots"]:
        raise ValueError(
            f"shots deve essere un intero tra 1 e {instance['max_shots']} per N={N}."
        )
    run_id = uuid.uuid4().hex[:12]
    if timeout_seconds is None:
        # Il caso rumoroso usa traiettorie stocastiche e scala con gli shot. Il tetto
        # pubblico e questo timeout impediscono a un worker guasto di monopolizzare il servizio.
        if N == N_FIXED:
            timeout_seconds = min(
                120.0,
                max(60.0, 30.0 + shots * (0.04 if active else 0.015)),
            )
        else:
            # Le istanze Beauregard sono molto piu' profonde. Il limite di shot e il
            # sottoprocesso impediscono che un run costoso blocchi stabilmente Render.
            timeout_seconds = min(
                180.0,
                max(75.0, 35.0 + shots * (0.75 if active else 0.18)),
            )
    try:
        process = subprocess.run(
            [sys.executable, os.path.abspath(__file__), "--worker"],
            input=json.dumps({"N": N, "shots": shots, "seed": seed, "noise": noise}),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        LOGGER.error("Aer worker %s non disponibile: %s", run_id, type(exc).__name__)
        raise SimulationUnavailable("Simulazione temporaneamente non disponibile.") from exc

    if process.returncode != 0:
        LOGGER.error(
            "Aer worker %s terminato con codice %s: %s",
            run_id,
            process.returncode,
            process.stderr[-4000:].strip(),
        )
        raise SimulationUnavailable("Simulazione temporaneamente non disponibile.")
    try:
        result = json.loads(process.stdout)
    except (TypeError, json.JSONDecodeError) as exc:
        LOGGER.error("Aer worker %s ha restituito JSON non valido.", run_id)
        raise SimulationUnavailable("Simulazione temporaneamente non disponibile.") from exc
    if not isinstance(result, dict) or result.get("ok") is not True:
        LOGGER.error("Aer worker %s ha restituito una risposta non valida.", run_id)
        raise SimulationUnavailable("Simulazione temporaneamente non disponibile.")
    return result


def _worker_main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        result = _simulate(payload)
    except Exception:
        # Il traceback resta nello stderr catturato dal server; non entra mai nel JSON pubblico.
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": "simulation_failed"}))
        return 1
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    raise SystemExit(_worker_main() if args.worker else 2)
