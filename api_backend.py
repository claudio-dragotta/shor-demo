"""Logica applicativa della demo FastAPI di Shor.

La versione 2 espone intenzionalmente solo il caso didattico verificato ``N=15, a=7`` con
otto qubit di conteggio. Le istanze Beauregard N=21/35 sono validate separatamente, ma
restano fuori dall'API pubblica per il loro costo di simulazione. Il modulo mantiene la vista
di Bloch ideale e aggiunge
un confronto riproducibile ideale/rumoroso basato sulla memoria reale di Aer.

Perche' lo stato di Bloch e' onesto anche sotto entanglement: lo stato del singolo qubit e' la
sua **matrice densita' ridotta** (traccia parziale dello statevector ideale). Quando il qubit e'
entangled con il resto, la matrice ridotta e' mista e il vettore di Bloch si **accorcia** (|r|<1)
— cosi' la freccia mostra sia lo stato vero sia il fatto che quel qubit non e' piu' separabile.
La vista usa solo ``qiskit.quantum_info`` ed e' sicura in-process nel worker FastAPI; le
esecuzioni Aer per la statistica restano isolate in sottoprocesso (``run_pair_isolated``).
"""
from __future__ import annotations

import importlib.metadata
import math
import platform
import secrets

import numpy as np

import shor_general as sg
from shor_general import extract_factors  # importato in shor_general da shor_core
from experiment_backend import (
    A_FIXED,
    GATE_TIME_1Q_NS,
    GATE_TIME_2Q_NS,
    MAX_SHOTS,
    N_COUNT_FIXED,
    N_FIXED,
    SimulationUnavailable,
    run_pair_isolated,
)

# Preset storici della tesi: UC1 moderato e UC2 stress, entrambi illustrativi.
ZERO_NOISE = {
    "eps_1q": 0.0,
    "eps_2q": 0.0,
    "t1_us": None,
    "t2_us": None,
    "readout_0to1": 0.0,
    "readout_1to0": 0.0,
    "coherent_overrotation_deg": 0.0,
}

# Preset storici della tesi, ora esposti con tutti i parametri espliciti e separati.
NOISE_PRESETS = {
    "none": dict(ZERO_NOISE),
    "uc1": {
        **ZERO_NOISE,
        "eps_1q": 1e-3,
        "eps_2q": 1e-2,
        "t1_us": 100.0,
        "t2_us": 80.0,
        "readout_0to1": 0.02,
        "readout_1to0": 0.02,
    },
    "uc2": {
        **ZERO_NOISE,
        "eps_1q": 5e-3,
        "eps_2q": 5e-2,
        "t1_us": 50.0,
        "t2_us": 30.0,
        "readout_0to1": 0.05,
        "readout_1to0": 0.05,
    },
}

THEORETICAL_PEAKS = (0, 64, 128, 192)
USEFUL_PEAKS = (64, 128, 192)

# Tetto per la vista stato-per-stato (sfere di Bloch): richiede lo statevector completo
# (2^num_qubits ampiezze) + una traccia parziale per qubit. Fattibile solo per circuiti piccoli
# — N=15 usa 12 qubit (4096 ampiezze). Gia' N=21 sale a 22 qubit (~4M) e N=35 a 26 (~67M):
# la simulazione esatta e' proibitiva (ed e' esattamente il motivo per cui Shor e' difficile da
# simulare classicamente). Oltre il tetto la vista Bloch non e' disponibile: si usa la statistica.
BLOCH_MAX_QUBITS = 16


def validate_instance(N: int, a: int | None = None, n_count: int | None = None) -> None:
    """Mantiene gli endpoint nel solo perimetro interattivo, indipendentemente dalla validazione."""
    if type(N) is not int or N != N_FIXED:
        raise ValueError("La demo web interattiva supporta esclusivamente N=15.")
    if a is not None and (type(a) is not int or a != A_FIXED):
        raise ValueError("Per l'istanza web N=15 la base deve essere a=7.")
    if n_count is not None and (type(n_count) is not int or n_count != N_COUNT_FIXED):
        raise ValueError("Per l'istanza web il registro di conteggio deve avere 8 qubit.")


# ---------------------------------------------------------------------------
# Fattorizzazione: pre-processing classico + metadati del circuito
# ---------------------------------------------------------------------------
def factor_info(N: int, seed: int | None = None) -> dict:
    """Configurazione e struttura dell'unica istanza esposta in modo interattivo."""
    del seed  # mantenuto nella firma per compatibilita' con chiamanti locali precedenti
    validate_instance(N)
    qc = sg.build_circuit(N_FIXED, A_FIXED, N_COUNT_FIXED)
    stages = _stages(qc, N_COUNT_FIXED)
    return {
        "N": N_FIXED,
        "done": False,
        "a": A_FIXED,
        "n_count": N_COUNT_FIXED,
        "num_qubits": qc.num_qubits,
        "validated": True,
        "validation_scope": "N=15, a=7, n_count=8",
        "n_stages": len(stages),
        "bloch_ok": qc.num_qubits <= BLOCH_MAX_QUBITS,
        "stages": [{"label": s["label"], "kind": s["kind"], "control": s["control"]} for s in stages],
    }


# ---------------------------------------------------------------------------
# Stadi del circuito (raggruppamento leggibile delle istruzioni)
# ---------------------------------------------------------------------------
_INIT_1Q = {"h", "x", "sx", "rz", "u", "u1", "u2", "u3", "s", "t", "p", "ry", "rx"}


def _stages(qc, n_count) -> list[dict]:
    """Raggruppa le istruzioni del circuito base in stadi didattici:
    0) stato iniziale |0..0>, 1) inizializzazione (H sul count, |1> sul lavoro),
    poi ogni moltiplicazione modulare controllata, la QFT^-1, e la misura.
    Ogni stadio porta l'indice `end` = quante istruzioni di qc.data applicare per raggiungerlo."""
    data = qc.data
    stages = [{"label": "Stato iniziale", "kind": "init0", "end": 0, "control": None}]

    i = 0
    while i < len(data):  # blocco iniziale di gate a 1 qubit (H sul count, X sul lavoro)
        name = data[i].operation.name.lower()
        if name == "barrier":
            i += 1
            continue
        if len(data[i].qubits) == 1 and name in _INIT_1Q:
            i += 1
            continue
        break
    stages.append({"label": "Inizializzazione", "kind": "init", "end": i, "control": None})

    u_idx = 0
    while i < len(data):
        inst = data[i]
        name = inst.operation.name
        low = name.lower()
        i += 1
        if low == "barrier":
            continue
        if low == "measure":
            while i < len(data) and data[i].operation.name.lower() == "measure":
                i += 1
            stages.append({"label": "Misura", "kind": "measure", "end": i, "control": None})
            continue
        if name.upper().startswith("QFT") or "qft" in low:
            stages.append({"label": "QFT⁻¹", "kind": "qft", "end": i, "control": None})
            continue
        # moltiplicazione modulare controllata: il qubit di conteggio in qargs e' il controllo
        idxs = [qc.find_bit(qb).index for qb in inst.qubits]
        ctrl = next((q for q in idxs if q < n_count), None)
        u_idx += 1
        stages.append({"label": f"U(a^{{2^{u_idx-1}}}) · mult. controllata #{u_idx}",
                       "kind": "u", "end": i, "control": ctrl})
    return stages


def _statevector_upto(qc, end):
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Statevector
    sub = QuantumCircuit(qc.num_qubits)
    for inst in qc.data[:end]:
        if inst.operation.name.lower() in ("barrier", "measure"):
            continue
        sub.append(inst.operation, inst.qubits)
    if len(sub.data) == 0:
        return Statevector.from_label("0" * qc.num_qubits)
    return Statevector.from_instruction(sub)


def _bloch_of_qubit(sv, qubit, num_qubits):
    """Vettore di Bloch (x,y,z) del qubit `qubit` dalla matrice densita' ridotta."""
    from qiskit.quantum_info import partial_trace
    trace_out = [q for q in range(num_qubits) if q != qubit]
    dm = partial_trace(sv, trace_out).data
    r01 = dm[0, 1]
    x = float(2 * r01.real)
    y = float(-2 * r01.imag)
    z = float((dm[0, 0] - dm[1, 1]).real)
    return x, y, z


def _ket_label(x, y, z):
    r = math.sqrt(x * x + y * y + z * z)
    if r < 0.82:
        return "entangled"
    if z > 0.9:
        return "|0⟩"
    if z < -0.9:
        return "|1⟩"
    if x > 0.82:
        return "|+⟩"
    if x < -0.82:
        return "|−⟩"
    return "α|0⟩+β|1⟩"


def bloch_at(N: int, a: int, n_count: int, stage: int, seed: int | None = None) -> dict:
    """Stato dei qubit di conteggio allo stadio `stage`: vettore di Bloch reale + operazione in
    corso + (alla misura) il bit collassato. `stage` 0..n_stages-1."""
    validate_instance(N, a, n_count)
    if type(stage) is not int or stage < 0:
        raise ValueError("Lo stadio deve essere un intero non negativo.")
    qc = sg.build_circuit(N_FIXED, A_FIXED, N_COUNT_FIXED)
    if qc.num_qubits > BLOCH_MAX_QUBITS:
        raise ValueError(f"Circuito troppo grande ({qc.num_qubits} qubit) per la vista "
                         "stato-per-stato. Disponibile per N piccoli come 15.")
    stages = _stages(qc, n_count)
    if stage >= len(stages):
        raise ValueError(f"Stadio non valido: usa un valore tra 0 e {len(stages) - 1}.")
    st = stages[stage]
    kind = st["kind"]

    measured_shot = None
    measurement_seed = None
    if kind == "measure":
        # campiona un esito dallo statevector PRE-misura (fine QFT^-1) — nessun Aer
        sv = _statevector_upto(qc, stages[stage - 1]["end"] if stage > 0 else 0)
        if seed is None:
            measurement_seed = secrets.randbelow(2 ** 31)
        elif type(seed) is not int or not 0 <= seed <= 2 ** 31 - 1:
            raise ValueError("seed deve essere un intero tra 0 e 2147483647.")
        else:
            measurement_seed = seed
        sv.seed(measurement_seed)
        mem = sv.sample_memory(1, qargs=list(range(n_count)))[0]  # little-endian
        bits = mem[::-1]  # bits[i] = qubit i
        val = int(mem, 2)
        p, q = extract_factors(val, N_COUNT_FIXED, N_FIXED, A_FIXED)
        ok = p is not None and p * q == N_FIXED
        measured_shot = {"value": val, "bits": mem, "ok": ok, "p": p, "q": q}
    else:
        sv = _statevector_upto(qc, st["end"])
        bits = None

    qubits = []
    for i in range(n_count):
        if kind == "measure":
            bit = bits[i]
            qubits.append({
                "i": i, "x": 0.0, "y": 0.0, "z": 1.0 if bit == "0" else -1.0,
                "len": 1.0, "op": "M", "name": "misura", "active": True,
                "collapsed": True, "bit": int(bit), "ket": f"|{bit}⟩",
                "ok": measured_shot["ok"],
            })
            continue
        x, y, z = _bloch_of_qubit(sv, i, qc.num_qubits)
        r = math.sqrt(x * x + y * y + z * z)
        active = (kind == "u" and st["control"] == i)
        if kind == "init0":
            op, name = "·", "a riposo"
        elif kind == "init":
            op, name = "H", "Hadamard"
        elif kind == "qft":
            op, name = "QFT", "QFT⁻¹"
        elif active:
            op, name = "●", "controllo"
        elif r < 0.82:
            op, name = "∿", "entangled"
        else:
            op, name = "⊕", "sovrapp."
        qubits.append({
            "i": i, "x": round(x, 4), "y": round(y, 4), "z": round(z, 4),
            "len": round(r, 4), "op": op, "name": name, "active": active,
            "collapsed": False, "ket": _ket_label(x, y, z),
        })

    return {
        "stage": stage, "n_stages": len(stages), "label": st["label"], "kind": kind,
        "control": st["control"], "n_count": n_count, "num_qubits": qc.num_qubits,
        "measurement_seed": measurement_seed,
        "measured_shot": measured_shot, "qubits": qubits,
    }


# ---------------------------------------------------------------------------
# Esperimento v2: memoria reale, distribuzione completa e metriche scientifiche
# ---------------------------------------------------------------------------
ITER_SHOWN_MAX = 80
_OUTCOME_INFO: dict[int, tuple[bool, list[int] | None]] = {}
for _value in range(2 ** N_COUNT_FIXED):
    _p, _q = extract_factors(_value, N_COUNT_FIXED, N_FIXED, A_FIXED)
    _ok = _p is not None and _q is not None and _p * _q == N_FIXED
    _OUTCOME_INFO[_value] = (_ok, sorted([int(_p), int(_q)]) if _ok else None)
_RANDOM_SUCCESSFUL_OUTCOMES = sum(1 for _ok, _ in _OUTCOME_INFO.values() if _ok)
RANDOM_FACTOR_FLOOR = _RANDOM_SUCCESSFUL_OUTCOMES / (2 ** N_COUNT_FIXED)


def _validate_shots_seed(shots: int, seed: int | None, *, min_shots: int) -> int:
    if type(shots) is not int or not min_shots <= shots <= MAX_SHOTS:
        raise ValueError(f"shots deve essere un intero tra {min_shots} e {MAX_SHOTS}.")
    if seed is None:
        return secrets.randbelow(2 ** 31)
    if type(seed) is not int or not 0 <= seed <= 2 ** 31 - 1:
        raise ValueError("seed deve essere un intero tra 0 e 2147483647.")
    return seed


def normalise_noise_config(noise: dict | None) -> dict:
    """Canonicalizza e valida il contratto del rumore anche fuori da FastAPI/Pydantic."""
    if noise is None:
        return dict(ZERO_NOISE)
    if not isinstance(noise, dict):
        raise ValueError("noise deve essere un oggetto.")
    unknown = set(noise) - set(ZERO_NOISE)
    if unknown:
        raise ValueError("Parametri di rumore non riconosciuti.")
    config = {**ZERO_NOISE, **noise}
    probability_fields = ("eps_1q", "eps_2q", "readout_0to1", "readout_1to0")
    for field in probability_fields:
        value = config[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{field} deve essere un numero tra 0 e 1.")
        value = float(value)
        if not math.isfinite(value) or not 0.0 <= value <= 1.0:
            raise ValueError(f"{field} deve essere un numero tra 0 e 1.")
        config[field] = value

    overrotation = config["coherent_overrotation_deg"]
    if isinstance(overrotation, bool) or not isinstance(overrotation, (int, float)):
        raise ValueError("coherent_overrotation_deg deve essere compreso tra -180 e 180.")
    overrotation = float(overrotation)
    if not math.isfinite(overrotation) or not -180.0 <= overrotation <= 180.0:
        raise ValueError("coherent_overrotation_deg deve essere compreso tra -180 e 180.")
    config["coherent_overrotation_deg"] = overrotation

    t1, t2 = config["t1_us"], config["t2_us"]
    if (t1 is None) != (t2 is None):
        raise ValueError("t1_us e t2_us devono essere specificati insieme.")
    if t1 is not None:
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in (t1, t2)):
            raise ValueError("t1_us e t2_us devono essere numeri positivi.")
        t1, t2 = float(t1), float(t2)
        if not math.isfinite(t1) or not math.isfinite(t2) or t1 <= 0 or t2 <= 0:
            raise ValueError("t1_us e t2_us devono essere numeri positivi.")
        if t2 > 2.0 * t1:
            raise ValueError("Il modello fisico richiede T2 <= 2*T1.")
        config["t1_us"], config["t2_us"] = t1, t2
    return config


def _wilson_interval(successes: int, total: int) -> dict:
    if total <= 0:
        return {"low": 0.0, "high": 0.0, "confidence": 0.95}
    z = 1.959963984540054
    proportion = successes / total
    denominator = 1.0 + z * z / total
    centre = (proportion + z * z / (2.0 * total)) / denominator
    margin = z * math.sqrt(
        proportion * (1.0 - proportion) / total + z * z / (4.0 * total * total)
    ) / denominator
    return {
        "low": max(0.0, centre - margin),
        "high": min(1.0, centre + margin),
        "confidence": 0.95,
    }


def _analyse_memory(memory: list[str]) -> dict:
    shots = len(memory)
    if shots <= 0:
        raise SimulationUnavailable("Simulazione temporaneamente non disponibile.")
    counts = [0] * (2 ** N_COUNT_FIXED)
    values = []
    for raw in memory:
        bits = str(raw).replace(" ", "")
        if len(bits) != N_COUNT_FIXED or set(bits) - {"0", "1"}:
            raise SimulationUnavailable("Simulazione temporaneamente non disponibile.")
        value = int(bits, 2)
        values.append((bits, value))
        counts[value] += 1

    n_ok = sum(counts[value] for value, (ok, _) in _OUTCOME_INFO.items() if ok)
    found_at = next((i for i, (_, value) in enumerate(values, 1) if _OUTCOME_INFO[value][0]), None)
    factors_found = None
    if found_at is not None:
        factors_found = list(_OUTCOME_INFO[values[found_at - 1][1]][1])
    top_value = max(range(len(counts)), key=lambda value: counts[value])
    modal_factors = _OUTCOME_INFO[top_value][1]

    probabilities = [count / shots for count in counts]
    entropy = -sum(p * math.log2(p) for p in probabilities if p > 0)
    peak_mass = sum(counts[v] for v in THEORETICAL_PEAKS) / shots
    useful_peak_mass = sum(counts[v] for v in USEFUL_PEAKS) / shots

    distribution = []
    for value, count in enumerate(counts):
        ok, factors = _OUTCOME_INFO[value]
        distribution.append(
            {
                "value": value,
                "bits": format(value, f"0{N_COUNT_FIXED}b"),
                "count": count,
                "probability": count / shots,
                "factor_success": ok,
                "factors": list(factors) if factors else None,
                "theoretical_peak": value in THEORETICAL_PEAKS,
                "useful_peak": value in USEFUL_PEAKS,
            }
        )

    iterations = []
    for shot, (bits, value) in enumerate(values[:ITER_SHOWN_MAX], 1):
        ok, factors = _OUTCOME_INFO[value]
        iterations.append(
            {
                "shot": shot,
                "value": value,
                "bits": bits,
                "ok": ok,
                "factors": list(factors) if factors else None,
            }
        )

    return {
        "shots": shots,
        "n_ok": n_ok,
        "factor_yield": n_ok / shots,
        "wilson_ci": _wilson_interval(n_ok, shots),
        "factors_found": factors_found,
        "found_at": found_at,
        "top_value": top_value,
        "modal_factors": list(modal_factors) if modal_factors else None,
        "peak_mass": peak_mass,
        "useful_peak_mass": useful_peak_mass,
        "entropy_bits": entropy,
        "memory": [bits for bits, _ in values],
        "iterations": iterations,
        "iterations_shown": len(iterations),
        "distribution": distribution,
    }


def _comparison(ideal: dict, noisy: dict, *, identical_sample: bool = False) -> dict:
    p = [row["probability"] for row in ideal["distribution"]]
    q = [row["probability"] for row in noisy["distribution"]]
    tvd = 0.5 * sum(abs(x - y) for x, y in zip(p, q))
    bhattacharyya = min(1.0, sum(math.sqrt(x * y) for x, y in zip(p, q)))
    ideal_yield = ideal["factor_yield"]
    noisy_yield = noisy["factor_yield"]
    delta = noisy_yield - ideal_yield
    if identical_sample:
        delta_ci = {
            "low": 0.0, "high": 0.0, "confidence": 1.0,
            "method": "exact_same_sample_zero_noise",
        }
    else:
        ideal_ci = ideal["wilson_ci"]
        noisy_ci = noisy["wilson_ci"]
        # Newcombe (Wilson senza correzione di continuita') per la differenza
        # dei due campioni Aer generati con stream deterministici indipendenti.
        delta_margin_low = math.sqrt(
            (noisy_yield - noisy_ci["low"]) ** 2
            + (ideal_ci["high"] - ideal_yield) ** 2
        )
        delta_margin_high = math.sqrt(
            (noisy_ci["high"] - noisy_yield) ** 2
            + (ideal_yield - ideal_ci["low"]) ** 2
        )
        delta_ci = {
            "low": max(-1.0, delta - delta_margin_low),
            "high": min(1.0, delta + delta_margin_high),
            "confidence": 0.95,
            "method": "newcombe_wilson_independent",
        }
    return {
        "tvd": tvd,
        "hellinger_fidelity": bhattacharyya ** 2,
        "hellinger_distance": math.sqrt(max(0.0, 1.0 - bhattacharyya)),
        "factor_yield_delta": delta,
        "factor_yield_delta_ci": delta_ci,
    }


def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _experiment(shots: int, seed: int | None, noise: dict | None, *, min_shots: int) -> dict:
    effective_seed = _validate_shots_seed(shots, seed, min_shots=min_shots)
    config = normalise_noise_config(noise)
    raw = run_pair_isolated(shots=shots, seed=effective_seed, noise=config)
    ideal = _analyse_memory(raw["ideal_memory"])
    noisy = _analyse_memory(raw["noisy_memory"])
    random_floor = {
        "probability": RANDOM_FACTOR_FLOOR,
        "successful_outcomes": _RANDOM_SUCCESSFUL_OUTCOMES,
        "total_outcomes": 2 ** N_COUNT_FIXED,
    }
    return {
        "schema_version": "2.0",
        "config": {
            "N": N_FIXED,
            "a": A_FIXED,
            "n_count": N_COUNT_FIXED,
            "shots": shots,
            "seed": effective_seed,
            "noise": config,
        },
        "ideal": ideal,
        "noisy": noisy,
        "comparison": _comparison(
            ideal, noisy, identical_sample=not any(
                value is not None and float(value) != 0.0
                for value in config.values()
            )
        ),
        "random_factor_floor": RANDOM_FACTOR_FLOOR,
        "metadata": {
            "versions": {
                "python": platform.python_version(),
                "qiskit": _package_version("qiskit"),
                "qiskit_aer": _package_version("qiskit-aer"),
            },
            "circuit": raw["circuit"],
            "simulation_seeds": raw["simulation_seeds"],
            "model": {
                "kind": "uniform_illustrative",
                "description": "Preset NISQ illustrativo uniforme; non emula una QPU specifica.",
                "per_qubit_calibration": False,
                "coupling_map": False,
                "routing": False,
                "drift": False,
                "gate_time_1q_ns": GATE_TIME_1Q_NS,
                "gate_time_2q_ns": GATE_TIME_2Q_NS,
                "virtual_rz": True,
                "coherent_error": "sovrarotazione RX(delta) solo dopo le porte fisiche sx/x",
            },
            "circuit_implementation": "n15-a7-textbook-orbit-v2",
            "theoretical_peaks": list(THEORETICAL_PEAKS),
            "useful_peaks": list(USEFUL_PEAKS),
            "random_factor_floor": random_floor,
        },
    }


def run_experiment(shots: int, seed: int | None = None, noise: dict | None = None) -> dict:
    """Contratto v2 pubblico; gli shot ammessi sono 10..2048."""
    return _experiment(shots, seed, noise, min_shots=10)


def run_stats(N: int, a: int, n_count: int, noise: str, shots: int, seed: int = 42) -> dict:
    """Adapter locale legacy, non esposto dall'API pubblica v2."""
    validate_instance(N, a, n_count)
    if noise not in NOISE_PRESETS:
        raise ValueError("noise deve essere uno tra: none, uc1, uc2.")
    experiment = _experiment(shots, seed, NOISE_PRESETS[noise], min_shots=1)
    selected = experiment["ideal"] if noise == "none" else experiment["noisy"]
    ranked = sorted(
        (row for row in selected["distribution"] if row["count"] > 0),
        key=lambda row: (-row["count"], row["value"]),
    )
    legacy_distribution = [
        {
            "value": row["value"],
            "bits": row["bits"],
            "count": row["count"],
            "probability": row["probability"],
            "ok": row["factor_success"],
        }
        for row in ranked[:12]
    ]
    return {
        "shots": shots,
        "noise": noise,
        "seed": experiment["config"]["seed"],
        "p_success": round(100.0 * selected["factor_yield"], 1),
        "factor_yield": selected["factor_yield"],
        "n_ok": selected["n_ok"],
        "total": selected["shots"],
        "factors_found": selected["factors_found"],
        "found_at": selected["found_at"],
        "iterations": selected["iterations"],
        "iterations_shown": selected["iterations_shown"],
        "distribution": legacy_distribution,
        "full_distribution": selected["distribution"],
        "memory": selected["memory"],
        "top_value": selected["top_value"],
        # Compatibilita' UI: questo campo ora significa "fattori trovati da almeno uno shot".
        "top_factors": selected["factors_found"],
        "modal_factors": selected["modal_factors"],
        "metrics": {
            "wilson_ci": selected["wilson_ci"],
            "peak_mass": selected["peak_mass"],
            "useful_peak_mass": selected["useful_peak_mass"],
            "entropy_bits": selected["entropy_bits"],
            "random_factor_floor": RANDOM_FACTOR_FLOOR,
        },
        "metadata": experiment["metadata"],
    }


# ---------------------------------------------------------------------------
# Self-test (senza server): python api_backend.py
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    info = factor_info(15)
    print("factor_info(15):", {k: info[k] for k in ("done", "a", "n_count", "num_qubits", "n_stages")})
    print("stadi:", [s["label"] for s in info["stages"]])
    for stg in (0, 1, 2, info["n_stages"] - 2, info["n_stages"] - 1):
        b = bloch_at(15, info["a"], info["n_count"], stg)
        row = " | ".join(f"c{q['i']}:{q['name']}(r={q.get('len','-')})" for q in b["qubits"][:4])
        print(f"  stadio {stg} [{b['label']}]: {row}")
    print("run_stats(15,none,64):", {k: run_stats(15, info["a"], info["n_count"], "none", 64)[k]
                                       for k in ("p_success", "top_factors")})
