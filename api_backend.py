"""Logica di backend per la demo FastAPI: riusa il Qiskit già validato (shor_general.py /
shor_core.py) e aggiunge il calcolo dello **stato di Bloch reale per qubit a ogni stadio** del
circuito di Shor.

Perche' lo stato di Bloch e' onesto anche sotto entanglement: lo stato del singolo qubit e' la
sua **matrice densita' ridotta** (traccia parziale dello statevector ideale). Quando il qubit e'
entangled con il resto, la matrice ridotta e' mista e il vettore di Bloch si **accorcia** (|r|<1)
— cosi' la freccia mostra sia lo stato vero sia il fatto che quel qubit non e' piu' separabile.
Nessun Aer qui (solo qiskit.quantum_info), quindi e' sicuro in-process nel worker FastAPI; le
esecuzioni rumorose per la statistica restano isolate in sottoprocesso (run_shots_isolated).
"""
from __future__ import annotations

import math
import random

import numpy as np

import shor_general as sg
from shor_general import extract_factors  # importato in shor_general da shor_core

# Preset di rumore: gli stessi due use case della tesi (UC1 realistico, UC2 degradato).
NOISE_PRESETS = {
    "none": None,
    "uc1": dict(eps_1q=1e-3, eps_2q=1e-2, t1_ns=100_000, t2_ns=80_000, p_ro=0.02),
    "uc2": dict(eps_1q=5e-3, eps_2q=5e-2, t1_ns=50_000, t2_ns=30_000, p_ro=0.05),
}

# Tetto per la vista stato-per-stato (sfere di Bloch): richiede lo statevector completo
# (2^num_qubits ampiezze) + una traccia parziale per qubit. Fattibile solo per circuiti piccoli
# — N=15 usa 12 qubit (4096 ampiezze). Gia' N=21 sale a 22 qubit (~4M) e N=35 a 26 (~67M):
# la simulazione esatta e' proibitiva (ed e' esattamente il motivo per cui Shor e' difficile da
# simulare classicamente). Oltre il tetto la vista Bloch non e' disponibile: si usa la statistica.
BLOCH_MAX_QUBITS = 16


# ---------------------------------------------------------------------------
# Fattorizzazione: pre-processing classico + metadati del circuito
# ---------------------------------------------------------------------------
def factor_info(N: int, seed: int | None = None) -> dict:
    """Pre-processing classico di Shor + struttura del circuito da mostrare.
    seed derivato da N (come nella demo Streamlit) per una scelta di base riproducibile."""
    seed = seed if seed is not None else N * 7919 + 42
    pp = sg.classical_preprocess(int(N), seed=seed)
    if pp["done"]:
        return {
            "N": int(N), "done": True, "reason": pp["reason"],
            "p": pp["p"], "q": pp["q"], "a": pp.get("a"),
        }
    a = pp["a"]
    n_count = sg.n_count_for(int(N))
    qc = sg.build_circuit(int(N), a, n_count)
    stages = _stages(qc, n_count)
    return {
        "N": int(N), "done": False, "a": a, "n_count": n_count,
        "num_qubits": qc.num_qubits, "validated": pp.get("validated", False),
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
    qc = sg.build_circuit(int(N), a, n_count)
    if qc.num_qubits > BLOCH_MAX_QUBITS:
        raise ValueError(f"Circuito troppo grande ({qc.num_qubits} qubit) per la vista "
                         "stato-per-stato. Disponibile per N piccoli come 15.")
    stages = _stages(qc, n_count)
    stage = max(0, min(stage, len(stages) - 1))
    st = stages[stage]
    kind = st["kind"]

    measured_shot = None
    if kind == "measure":
        # campiona un esito dallo statevector PRE-misura (fine QFT^-1) — nessun Aer
        sv = _statevector_upto(qc, stages[stage - 1]["end"] if stage > 0 else 0)
        mem = sv.sample_memory(1, qargs=list(range(n_count)))[0]  # little-endian
        bits = mem[::-1]  # bits[i] = qubit i
        val = int(mem, 2)
        p, q = extract_factors(val, n_count, int(N), a)
        ok = p is not None and p * q == int(N)
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
        "measured_shot": measured_shot, "qubits": qubits,
    }


# ---------------------------------------------------------------------------
# Statistica: esegue il circuito molte volte (rumoroso o no) e riassume
# ---------------------------------------------------------------------------
ITER_SHOWN_MAX = 80  # quante singole iterazioni mostrare nella griglia visiva


def run_stats(N: int, a: int, n_count: int, noise: str, shots: int, seed: int = 42) -> dict:
    noise_cfg = NOISE_PRESETS.get(noise, None)
    counts = sg.run_shots_isolated(int(N), a, n_count, noise_cfg, shots=int(shots), seed=seed)
    total = sum(counts.values()) or 1

    # esito -> (fattori, successo), calcolato una volta
    info = {}
    for b in counts:
        val = int(b, 2)
        p, q = extract_factors(val, n_count, int(N), a)
        ok = p is not None and p * q == int(N)
        info[b] = (val, ok, [p, q] if ok else None)
    n_ok = sum(counts[b] for b in counts if info[b][1])

    dist = [{"value": info[b][0], "count": counts[b], "ok": info[b][1]} for b in counts]
    dist.sort(key=lambda d: -d["count"])

    # Sequenza delle singole iterazioni: gli shot sono i.i.d., quindi un riordino casuale dei
    # conteggi è statisticamente identico all'ordine reale — evita di dover trasportare la memoria
    # per-shot. Serve per mostrare VISIVAMENTE i tentativi e "trovato al tentativo k".
    seq = []
    for b, c in counts.items():
        seq.extend([b] * c)
    random.Random(int(seed) * 13 + int(shots)).shuffle(seq)
    found_at = next((i + 1 for i, b in enumerate(seq) if info[b][1]), None)
    iterations = [{"value": info[b][0], "ok": info[b][1]} for b in seq[:ITER_SHOWN_MAX]]

    top = dist[0] if dist else None
    top_factors = None
    if top is not None:
        p, q = extract_factors(top["value"], n_count, int(N), a)
        if p and p * q == int(N):
            top_factors = [p, q]

    return {
        "shots": int(shots), "noise": noise,
        "p_success": round(100 * n_ok / total, 1),
        "n_ok": n_ok, "total": total,
        "found_at": found_at,
        "iterations": iterations, "iterations_shown": len(iterations),
        "distribution": dist[:12],
        "top_value": top["value"] if top else None,
        "top_factors": top_factors,
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
