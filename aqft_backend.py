"""QFT approssimata (AQFT) nella demo: circuito, costo compilato, effetto ideale e rumore.

Il troncamento e' quello della campagna M15 della tesi (``qft_approssimata.py``): nella QFT
inversa finale si tengono soltanto le rotazioni controllate con distanza ``j - m <= k``.
Con ``n_count = 8`` le distanze vanno da 1 a 7, quindi ``k = 7`` e' la QFT piena e ``k = 1``
tiene soltanto le rotazioni fra qubit vicini. ``k_arith`` non serve: per N=15 il
moltiplicatore ``c_amod15`` non contiene trasformate.

Che cosa NON e' questa sezione. Il rumore e' lo stesso modello uniforme e illustrativo del
laboratorio (base ``rz/sx/x/cx``, ``rz`` virtuali), non la snapshot FakeSherbrooke con porte
ECR di M15. I numeri live mostrano il meccanismo; i numeri citabili della tesi arrivano a
parte, letti dagli artefatti M15 (``precomputed/aqft_tesi.json``).

Il circuito canonico non viene toccato: si riassembla dai mattoni di ``shor_core`` come fa
M15, e ``verifica_grado_pieno`` controlla che a ``k = 7`` il circuito compilato coincida con
quello usato da tutto il resto della demo.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import subprocess
import sys
import traceback
import uuid
from functools import lru_cache
from typing import Any

import numpy as np

from experiment_backend import (
    BASIS_GATES,
    NOISY_SEED_OFFSET,
    SEED_TRANSPILER,
    SimulationUnavailable,
    build_illustrative_noise_model,
    noise_is_active,
)

LOGGER = logging.getLogger(__name__)
_HERE = os.path.dirname(os.path.abspath(__file__))

N_AQFT = 15
A_AQFT = 7
N_COUNT = 8
N_WORK = 4
K_FULL = N_COUNT - 1
K_VALUES = tuple(range(1, K_FULL + 1))
AQFT_MAX_SHOTS = 2048
AQFT_MIN_SHOTS = 32
# Lo stream del braccio AQFT e' indipendente da quello della QFT piena: l'IC di Newcombe
# usato per la differenza assume due campioni indipendenti. Aer usa seed + i per lo shot i,
# quindi l'offset deve superare il numero massimo di shot (verificato nei test).
AQFT_SEED_OFFSET = 2_000_003


def _validate_k(k: int) -> int:
    if isinstance(k, bool) or type(k) is not int or not 1 <= k <= K_FULL:
        raise ValueError(f"k deve essere un intero tra 1 e {K_FULL}.")
    return k


# ---------------------------------------------------------------------------
# Costruzione
# ---------------------------------------------------------------------------
def inverse_qft_approx(n_qubits: int, k: int):
    """QFT inversa textbook con le sole ``cp`` a distanza ``j - m <= k``.

    Identica a ``shor_core.inverse_qft`` quando ``k >= n_qubits - 1`` e alla variante con
    SWAP presenti di M15 per ogni ``k``. I SWAP restano: M15 ha misurato che toglierli non
    cambia nulla, perche' il transpiler li assorbe gia'.
    """
    from qiskit import QuantumCircuit

    if k < 1:
        raise ValueError("k deve essere almeno 1: k=0 elimina ogni rotazione.")
    qc = QuantumCircuit(n_qubits, name="QFT†" if k >= n_qubits - 1 else f"QFT†~{k}")
    for qubit in range(n_qubits // 2):
        qc.swap(qubit, n_qubits - qubit - 1)
    for j in range(n_qubits):
        for m in range(j):
            if j - m <= k:
                qc.cp(-np.pi / float(2 ** (j - m)), m, j)
        qc.h(j)
    return qc


def build_aqft_circuit(k: int, *, measure: bool = True, a: int = A_AQFT, n_count: int = N_COUNT):
    """Circuito di Shor N=15 con QFT inversa troncata al grado ``k``.

    Stesso assemblaggio di ``shor_core.shor_circuit`` per N=15: si cambia soltanto la
    trasformata finale. La demo usa ``a=7, n_count=8``; gli altri valori servono ai test
    (tutte le basi ammesse da ``c_amod15`` e registri di dimensione diversa).
    """
    from qiskit import QuantumCircuit
    from shor_core import c_amod15

    if isinstance(n_count, bool) or type(n_count) is not int or n_count < 2:
        raise ValueError("n_count deve essere un intero >= 2.")
    if a == A_AQFT and n_count == N_COUNT:
        _validate_k(k)
    elif isinstance(k, bool) or type(k) is not int or not 1 <= k <= n_count - 1:
        raise ValueError(f"k deve essere un intero tra 1 e {n_count - 1}.")
    qc = QuantumCircuit(n_count + N_WORK, n_count)
    for q in range(n_count):
        qc.h(q)
    qc.x(n_count + 3)
    for j in range(n_count):
        if 2 ** j % 4 != 0:
            qc.append(c_amod15(a, 2 ** j), [j] + list(range(n_count, n_count + N_WORK)))
    qc.barrier()
    qc.append(inverse_qft_approx(n_count, k), range(n_count))
    if measure:
        qc.measure(range(n_count), range(n_count))
    return qc


def _transpile(circuit):
    from qiskit import transpile

    return transpile(
        circuit,
        basis_gates=BASIS_GATES,
        optimization_level=2,
        seed_transpiler=SEED_TRANSPILER,
    )


def _fingerprint(circuit) -> str:
    """Stesso hash di ``circuit_fingerprint`` in ``campagne_classiche_M1-M4/shor_core.py``.

    Replicato qui perche' la demo viaggia da sola nell'immagine. A grado pieno deve dare lo
    SHA canonico del circuito corretto citato nella tesi.
    """
    instructions = []
    for item in circuit.data:
        op = item.operation
        instructions.append({
            "name": op.name,
            "params": [str(parameter) for parameter in op.params],
            "qubits": [circuit.find_bit(qubit).index for qubit in item.qubits],
            "clbits": [circuit.find_bit(clbit).index for clbit in item.clbits],
        })
    canonical = json.dumps(instructions, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# SHA-256 del circuito canonico N=15 compilato, lo stesso degli artefatti v2 della tesi.
CANONICAL_SHA256 = "c7f4cf3bc1735dce9d5b56d8e09686ee4ab43cabead65e734ea23d5a50f4ba2c"


@lru_cache(maxsize=None)
def compiled_circuit(k: int):
    """Compilazione deterministica, memoizzata: i gradi possibili sono sette."""
    return _transpile(build_aqft_circuit(_validate_k(k)))


def verifica_grado_pieno() -> dict:
    """A ``k = 7`` il circuito deve essere quello del laboratorio del rumore.

    Senza questa identita' il confronto con la QFT piena non direbbe nulla: si
    confronterebbero due costruzioni diverse, non due trasformate.
    """
    import shor_general as sg

    riferimento = _transpile(sg.build_circuit(N_AQFT, A_AQFT, N_COUNT))
    ricostruito = compiled_circuit(K_FULL)
    atteso, ottenuto = _fingerprint(riferimento), _fingerprint(ricostruito)
    if atteso != ottenuto:
        raise RuntimeError("Il circuito AQFT a grado pieno non coincide con quello della demo.")
    return {
        "sha256": ottenuto,
        "identico_al_laboratorio": True,
        "canonico_tesi": ottenuto == CANONICAL_SHA256,
    }


# ---------------------------------------------------------------------------
# Struttura: rotazioni, costo, distribuzione ideale esatta
# ---------------------------------------------------------------------------
def rotazioni(k: int) -> list[dict]:
    """Le 28 rotazioni della QFT inversa a 8 qubit, con quelle che il grado ``k`` toglie."""
    _validate_k(k)
    elenco = []
    for j in range(N_COUNT):
        for m in range(j):
            distanza = j - m
            elenco.append({
                "control": m,
                "target": j,
                "distance": distanza,
                "angle_rad": -math.pi / 2 ** distanza,
                "angle_label": f"-π/{2 ** distanza}",
                "kept": distanza <= k,
            })
    return elenco


@lru_cache(maxsize=1)
def _outcome_ok() -> tuple[bool, ...]:
    from shor_general import extract_factors

    ok = []
    for value in range(2 ** N_COUNT):
        p, q = extract_factors(value, N_COUNT, N_AQFT, A_AQFT)
        ok.append(p is not None and q is not None and p * q == N_AQFT)
    return tuple(ok)


@lru_cache(maxsize=None)
def ideal_distribution(k: int) -> tuple[float, ...]:
    """Distribuzione esatta degli esiti del registro di conteggio, senza rumore.

    Statevector di 12 qubit (4096 ampiezze): costa millisecondi. ``probabilities`` con i
    qubit di conteggio come ``qargs`` mette il qubit 0 nel bit meno significativo, come
    ``measure(range(8), range(8))`` fa con i bit classici.
    """
    from qiskit.quantum_info import Statevector

    stato = Statevector.from_instruction(build_aqft_circuit(_validate_k(k), measure=False))
    probabilita = stato.probabilities(qargs=list(range(N_COUNT)))
    totale = float(np.sum(probabilita))
    return tuple(float(p) / totale for p in probabilita)


def _riassunto_ideale(k: int) -> dict:
    p = ideal_distribution(k)
    pieno = ideal_distribution(K_FULL)
    ok = _outcome_ok()
    picchi = (0, 64, 128, 192)
    return {
        "factor_yield": sum(x for x, good in zip(p, ok) if good),
        "peak_mass": sum(p[v] for v in picchi),
        "tvd_vs_full": 0.5 * sum(abs(a - b) for a, b in zip(p, pieno)),
        "max_off_peak": max(x for v, x in enumerate(p) if v not in picchi),
    }


def _conteggi(compilato) -> dict:
    ops = {str(name): int(n) for name, n in compilato.count_ops().items()}
    return {
        "cx": ops.get("cx", 0),
        "rz": ops.get("rz", 0),
        "sx_x": ops.get("sx", 0) + ops.get("x", 0),
        "measure": ops.get("measure", 0),
        "depth": int(compilato.depth()),
        "size": int(compilato.size()) - ops.get("barrier", 0),
    }


@lru_cache(maxsize=1)
def aqft_structure() -> dict:
    """Tutto cio' che non richiede rumore, per tutti i gradi: lo si calcola una volta."""
    gradi = []
    for k in K_VALUES:
        rot = rotazioni(k)
        tenute = sum(1 for r in rot if r["kept"])
        gradi.append({
            "k": k,
            "is_full": k == K_FULL,
            "rotations_kept": tenute,
            "rotations_removed": len(rot) - tenute,
            "smallest_angle_label": f"π/{2 ** k}",
            "compiled": _conteggi(compiled_circuit(k)),
            "ideal": _riassunto_ideale(k),
            "sha256": _fingerprint(compiled_circuit(k)),
            "ideal_distribution": [round(x, 10) for x in ideal_distribution(k)],
        })
    verifica = verifica_grado_pieno()
    return {
        "schema_version": "1.0",
        "N": N_AQFT, "a": A_AQFT, "n_count": N_COUNT,
        "k_full": K_FULL,
        "k_definition": "si tengono le cp della QFT inversa con distanza j-m <= k (come M15)",
        "theoretical_peaks": [0, 64, 128, 192],
        "random_factor_floor": sum(_outcome_ok()) / 2 ** N_COUNT,
        "basis_gates": list(BASIS_GATES),
        "seed_transpiler": SEED_TRANSPILER,
        "full_circuit_check": verifica,
        "rotations": rotazioni(1),
        "degrees": gradi,
    }


# ---------------------------------------------------------------------------
# Esperimento rumoroso: QFT piena contro AQFT, stesso modello di rumore
# ---------------------------------------------------------------------------
def _normalise_memory(memory: list[str]) -> list[str]:
    return [str(item).replace(" ", "").zfill(N_COUNT)[-N_COUNT:] for item in memory]


def _simulate_pair(payload: dict[str, Any]) -> dict[str, Any]:
    from qiskit_aer import AerSimulator

    k = _validate_k(int(payload["k"]))
    shots = int(payload["shots"])
    seed = int(payload["seed"])
    noise = dict(payload["noise"])
    # La QFT piena usa la stessa regola del campione rumoroso del laboratorio: con lo stesso
    # seed, gli stessi shot e lo stesso rumore il braccio "piena" e' identico, shot per shot,
    # a quello che il laboratorio mostra. L'AQFT parte da un flusso disgiunto.
    seed_full = (seed + NOISY_SEED_OFFSET) % (2 ** 31)
    seed_aqft = (seed_full + AQFT_SEED_OFFSET) % (2 ** 31)
    modello = build_illustrative_noise_model(noise)
    simulatore = AerSimulator(noise_model=modello, method="matrix_product_state")
    bracci = {}
    for nome, grado, seme in (("full", K_FULL, seed_full), ("aqft", k, seed_aqft)):
        risultato = simulatore.run(
            compiled_circuit(grado), shots=shots, seed_simulator=seme, memory=True
        ).result()
        bracci[nome] = {"memory": _normalise_memory(risultato.get_memory()), "seed": seme}
    return {"ok": True, **bracci}


def run_pair_isolated(*, k: int, shots: int, seed: int, noise: dict[str, Any]) -> dict[str, Any]:
    """Aer in un sottoprocesso, come il resto della demo: un crash nativo non tocca il server."""
    run_id = uuid.uuid4().hex[:12]
    timeout = min(150.0, max(60.0, 30.0 + shots * 0.06))
    try:
        process = subprocess.run(
            [sys.executable, os.path.abspath(__file__), "--worker"],
            input=json.dumps({"k": k, "shots": shots, "seed": seed, "noise": noise}),
            capture_output=True, text=True, timeout=timeout, check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        LOGGER.error("AQFT worker %s non disponibile: %s", run_id, type(exc).__name__)
        raise SimulationUnavailable("Simulazione temporaneamente non disponibile.") from exc
    if process.returncode != 0:
        LOGGER.error("AQFT worker %s uscito con %s: %s", run_id, process.returncode,
                     process.stderr[-4000:].strip())
        raise SimulationUnavailable("Simulazione temporaneamente non disponibile.")
    try:
        result = json.loads(process.stdout)
    except (TypeError, json.JSONDecodeError) as exc:
        raise SimulationUnavailable("Simulazione temporaneamente non disponibile.") from exc
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise SimulationUnavailable("Simulazione temporaneamente non disponibile.")
    return result


def _newcombe(yield_a: float, ci_a: dict, yield_b: float, ci_b: dict) -> dict:
    """IC di Newcombe (Wilson, campioni indipendenti) per ``yield_a - yield_b``."""
    delta = yield_a - yield_b
    basso = math.sqrt((yield_a - ci_a["low"]) ** 2 + (ci_b["high"] - yield_b) ** 2)
    alto = math.sqrt((ci_a["high"] - yield_a) ** 2 + (yield_b - ci_b["low"]) ** 2)
    return {
        "difference": delta,
        "low": max(-1.0, delta - basso),
        "high": min(1.0, delta + alto),
        "confidence": 0.95,
        "method": "newcombe_wilson_independent",
    }


def run_aqft_experiment(*, k: int, shots: int, seed: int | None, noise: dict | None) -> dict:
    """Stessi shot e stesso rumore sui due circuiti; seed indipendenti e registrati."""
    import api_backend as api

    _validate_k(k)
    if isinstance(shots, bool) or type(shots) is not int or not AQFT_MIN_SHOTS <= shots <= AQFT_MAX_SHOTS:
        raise ValueError(f"shots deve essere un intero tra {AQFT_MIN_SHOTS} e {AQFT_MAX_SHOTS}.")
    effective_seed = api._validate_shots_seed(shots, seed, min_shots=AQFT_MIN_SHOTS)
    config = api.normalise_noise_config(noise)
    if not noise_is_active(config):
        raise ValueError("Serve almeno un canale di rumore attivo: senza rumore i due circuiti "
                         "si confrontano esattamente nella sezione ideale.")
    raw = run_pair_isolated(k=k, shots=shots, seed=effective_seed, noise=config)
    full = api._analyse_memory(raw["full"]["memory"], N_AQFT)
    aqft = api._analyse_memory(raw["aqft"]["memory"], N_AQFT)
    for arm in (full, aqft):
        arm.pop("memory", None)
        arm.pop("iterations", None)
        arm["distribution"] = [row["count"] for row in arm["distribution"]]
    struttura = aqft_structure()
    gradi = {g["k"]: g for g in struttura["degrees"]}
    return {
        "schema_version": "1.0",
        "config": {
            "N": N_AQFT, "a": A_AQFT, "n_count": N_COUNT,
            "k": k, "k_full": K_FULL, "shots": shots, "seed": effective_seed, "noise": config,
        },
        "full": {**full, "compiled": gradi[K_FULL]["compiled"],
                 "ideal_factor_yield": gradi[K_FULL]["ideal"]["factor_yield"]},
        "aqft": {**aqft, "compiled": gradi[k]["compiled"],
                 "ideal_factor_yield": gradi[k]["ideal"]["factor_yield"]},
        "comparison": _newcombe(aqft["factor_yield"], aqft["wilson_ci"],
                                full["factor_yield"], full["wilson_ci"]),
        "random_factor_floor": struttura["random_factor_floor"],
        "metadata": {
            "simulation_seeds": {"full": raw["full"]["seed"], "aqft": raw["aqft"]["seed"],
                                 "independent_streams": True},
            "model": {
                "kind": "uniform_illustrative",
                "description": ("Stesso modello uniforme del laboratorio del rumore: non e' la "
                                "snapshot FakeSherbrooke della campagna M15."),
                "basis_gates": list(BASIS_GATES),
                "virtual_rz": True,
            },
            "seed_transpiler": SEED_TRANSPILER,
            "data_source": "live_qiskit_aer_mps",
        },
    }


# ---------------------------------------------------------------------------
# Stadio per stadio: sfere di Bloch del circuito AQFT, con e senza rumore
# ---------------------------------------------------------------------------
def _firma_bloch(k: int, noise: dict) -> str:
    """Chiave stabile (k, rumore sulle porte) per il precalcolo su file."""
    canonico = json.dumps({"k": int(k), "noise": noise}, sort_keys=True,
                          separators=(",", ":"), default=str)
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


def _rumore_sulle_porte(noise: dict | None) -> dict:
    """Il readout agisce sull'esito, non sullo stato: per le sfere si azzera.

    E' la stessa scelta di ``api_backend.noisy_bloch``: simularlo costerebbe tempo per
    ottenere esattamente le stesse matrici densita'.
    """
    import api_backend as api

    config = api.normalise_noise_config(noise)
    return {**config, "readout_0to1": 0.0, "readout_1to0": 0.0}


@lru_cache(maxsize=1)
def _bloch_precalcolato() -> dict:
    return _leggi_json("aqft_bloch.json").get("voci", {})


@lru_cache(maxsize=16)
def _aqft_bloch_cached(k: int, noise_key: tuple) -> dict:
    from experiment_backend import run_bloch_isolated

    return run_bloch_isolated(N=N_AQFT, noise=dict(noise_key), k=k)


def aqft_bloch(k: int, noise: dict | None = None) -> dict:
    """Stato ridotto dei qubit di conteggio a ogni stadio del circuito con QFT troncata.

    Prima si cerca nel precalcolo (ogni k con i preset), poi si simula: una matrice
    densita' a 12 qubit, circa un minuto in locale e due su Render.
    """
    _validate_k(k)
    porte = _rumore_sulle_porte(noise)
    voce = _bloch_precalcolato().get(_firma_bloch(k, porte))
    if voce is not None:
        return {**voce, "source": "precomputed"}
    return {**_aqft_bloch_cached(k, tuple(sorted(porte.items()))), "source": "live"}


# ---------------------------------------------------------------------------
# Dati precalcolati
# ---------------------------------------------------------------------------
def _leggi_json(nome: str) -> dict:
    percorso = os.path.join(_HERE, "precomputed", nome)
    try:
        with open(percorso, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        LOGGER.info("%s non disponibile (%s).", nome, type(exc).__name__)
        return {}


@lru_cache(maxsize=1)
def aqft_curva() -> dict:
    """Resa contro grado sotto i preset illustrativi, da ``precalcola_aqft.py``."""
    return _leggi_json("aqft_curva.json")


@lru_cache(maxsize=1)
def aqft_tesi() -> dict:
    """Risultati M15 estratti dagli artefatti della tesi da ``estrai_dati_aqft.py``."""
    return _leggi_json("aqft_tesi.json")


def _worker_main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        result = _simulate_pair(payload)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": "simulation_failed"}))
        return 1
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, _HERE)
    if "--worker" in sys.argv:
        raise SystemExit(_worker_main())
    s = aqft_structure()
    for g in s["degrees"]:
        c, i = g["compiled"], g["ideal"]
        print(f"k={g['k']}  rot {g['rotations_kept']:2d}/28  cx {c['cx']:3d}  rz {c['rz']:3d}  "
              f"depth {c['depth']:3d}  P_ideale {i['factor_yield']:.4f}  TVD {i['tvd_vs_full']:.2e}")
    print("grado pieno:", s["full_circuit_check"])
