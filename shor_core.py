"""Circuiti QPE locali usati dalla demo e dalle regressioni scientifiche.

N=15 usa il moltiplicatore textbook; N=21/35 usano l'aritmetica Beauregard validata. La demo
web espone soltanto N=15 per mantenere interattivo il costo della simulazione classica.
"""
import numpy as np
from math import gcd, ceil, log2
from fractions import Fraction
from qiskit import QuantumCircuit, transpile
from qiskit.circuit.library import UnitaryGate
from qiskit_aer import AerSimulator
from qiskit_aer.noise import (
    NoiseModel, depolarizing_error, thermal_relaxation_error, ReadoutError
)
from beauregard import beauregard_c_amod


# --- Inverse QFT (textbook convention) ---
def inverse_qft(n_qubits):
    qc = QuantumCircuit(n_qubits, name='QFT†')
    for qubit in range(n_qubits // 2):
        qc.swap(qubit, n_qubits - qubit - 1)
    for j in range(n_qubits):
        for m in range(j):
            qc.cp(-np.pi / float(2 ** (j - m)), m, j)
        qc.h(j)
    return qc


# --- Controlled modular exponentiation (textbook loop-based, N=15 only) ---
def c_amod15(a, power):
    if a not in [2, 7, 8, 11, 13]:
        raise ValueError(f"a={a} non supportato per N=15.")
    U = QuantumCircuit(4)
    for _ in range(power):
        if a in [2, 13]:
            U.swap(0, 1); U.swap(1, 2); U.swap(2, 3)
        if a in [7, 8]:
            U.swap(2, 3); U.swap(1, 2); U.swap(0, 1)
        if a == 11:
            U.swap(1, 3); U.swap(0, 2)
        if a in [7, 11, 13]:
            U.x(range(4))
    U.name = f'{a}^{power} mod 15'
    return U.control(annotated=False)


# --- Controlled modular exponentiation (generale, per N qualsiasi) ---
def c_amod(a, N, power):
    """
    Gate controllato U|x⟩ = |a^power·x mod N⟩ via matrice di permutazione.
    Usa UnitaryGate: corretto per qualsiasi N,a con gcd(a,N)=1.
    """
    n_work = ceil(log2(N + 1))
    size = 2 ** n_work
    a_pow = pow(a, power, N)
    # Matrice di permutazione: mat[y,x]=1 iff y = a_pow*x mod N
    mat = np.zeros((size, size), dtype=complex)
    for x in range(size):
        if x == 0 or x >= N:
            mat[x, x] = 1.0  # identità per 0 e fuori range
        else:
            y = (a_pow * x) % N
            mat[y, x] = 1.0
    gate = UnitaryGate(mat, label=f'{a}^{power} mod {N}')
    return gate.control(1, annotated=False)


# --- Shor circuit (QPE per N=15, N=21, N=35) ---
def shor_circuit(N, a, n_count):
    """
    Costruisce il circuito QPE per l'algoritmo di Shor.
    N=15: usa c_amod15 (loop-based, efficiente).
    N=21, N=35: usa beauregard_c_amod, validato aritmeticamente ma costoso da simulare.
    """
    if N == 15:
        n_work = 4
        qc = QuantumCircuit(n_count + n_work, n_count)
        for q in range(n_count):
            qc.h(q)
        qc.x(n_count + 3)  # |1⟩ nella convenzione textbook (qubit MSB=1 → stato 8)
        for j in range(n_count):
            if 2 ** j % 4 != 0:
                qc.append(c_amod15(a, 2 ** j),
                           [j] + list(range(n_count, n_count + n_work)))
    else:
        if N not in [21, 35]:
            raise NotImplementedError(f"N={N} non supportato. Usa N in {{15, 21, 35}}.")
        # Riferimento riproducibile di costo (Qiskit 2.5.0, optimization_level=2,
        # seed_transpiler=20260819, base RZ/SX/X/CX): N=21, a=2, n_count=8 produce
        # 21.036 CX e profondita' 23.081. Il proxy indipendente di nessun evento
        # 2Q e' soltanto (1-lambda_2q)^21036 = 7,237862389e-10 per
        # lambda_2q=0,001: non e' una
        # probabilita' di successo, una fedelta' o una misura della QPE.
        # Layout qubit Beauregard: [count | x(n) | b(n+1) | anc]
        n = ceil(log2(N + 1))
        n_b = n + 1
        n_total = n_count + n + n_b + 1   # ctrl_qubits + x + b + ancilla
        qc = QuantumCircuit(n_total, n_count)
        for q in range(n_count):
            qc.h(q)
        # Inizializza x a |1⟩: flip qubit MSB del registro x (qubit n_count + n - 1)
        qc.x(n_count + n - 1)
        for j in range(n_count):
            power = 2 ** j
            if pow(a, power, N) != 1:
                gate = beauregard_c_amod(a, N, power)
                # Qubits: ctrl=j, x=n_count..n_count+n-1, b=n_count+n..n_count+n+n_b-1, anc=last
                x_qubits = list(range(n_count, n_count + n))
                b_qubits = list(range(n_count + n, n_count + n + n_b))
                anc_qubit = [n_count + n + n_b]
                qc.append(gate, [j] + x_qubits + b_qubits + anc_qubit)

    qc.barrier()
    qc.append(inverse_qft(n_count), range(n_count))
    qc.measure(range(n_count), range(n_count))
    return qc


# --- Post-processing ---
def extract_factors(measured_value, n_count, N, a):
    if measured_value == 0:
        return None, None
    phase = measured_value / (2 ** n_count)
    frac = Fraction(phase).limit_denominator(N)
    r = frac.denominator
    if r % 2 != 0:
        return None, None
    p = gcd(a ** (r // 2) - 1, N)
    q = gcd(a ** (r // 2) + 1, N)
    if 1 < p < N:
        return p, N // p
    if 1 < q < N:
        return q, N // q
    return None, None


# --- Noise model ---
def build_noise_model(eps_1q, eps_2q, t1_ns, t2_ns, gate_time_ns=50, p_ro=0.02):
    nm = NoiseModel()
    nm.add_all_qubit_quantum_error(depolarizing_error(eps_1q, 1), ['h', 'x', 'rz'])
    nm.add_all_qubit_quantum_error(depolarizing_error(eps_2q, 2), ['cx', 'swap', 'cp'])
    nm.add_all_qubit_quantum_error(
        thermal_relaxation_error(t1_ns, t2_ns, gate_time_ns), ['h', 'x'])
    nm.add_all_qubit_readout_error(
        ReadoutError([[1 - p_ro, p_ro], [p_ro, 1 - p_ro]]))
    return nm


def _sim(noise_model=None):
    """AerSimulator MPS (matrix product state) — molto più veloce per circuiti profondi."""
    kw = {'method': 'matrix_product_state'}
    return AerSimulator(noise_model=noise_model, **kw) if noise_model else AerSimulator(**kw)


# --- Metodo 1 (TOP-1: picco più frequente per iterazione) ---
def run_method1(N, a, n_count, noise_model, shots=1024,
                max_iter=50, seed=42):
    base_qc = shor_circuit(N, a, n_count)
    # opt=2: elimina SWAP residui dall'IQFT e decompone CCX → CX (corretto per noise model)
    sim = _sim(noise_model)
    transpiled = transpile(base_qc, sim, optimization_level=2)
    for iteration in range(1, max_iter + 1):
        counts = sim.run(transpiled, shots=shots,
                         seed_simulator=seed * 10000 + iteration).result().get_counts()
        meas = int(max(counts, key=counts.get), 2)
        p, q = extract_factors(meas, n_count, N, a)
        if p is not None:
            return {'factors': (p, q), 'iterations': iteration, 'success': True,
                    'counts': counts}
    return {'factors': (None, None), 'iterations': max_iter, 'success': False,
            'counts': {}}


# --- Metodo 2 — classificatore ML + ricerca TOP-K ---
def run_method2(N, a, n_count, noise_model, classifier,
                shots=1024, max_iter=50, seed=42, top_k=4):
    """
    M2: il classificatore decide se l'istogramma ha segnale QPE recuperabile (top_k=4).
    Se clf=1, prova i top_k candidati più frequenti in ordine decrescente — cattura picchi
    QPE spostati dal rumore (es. mode=65 invece di 64). Se clf=0, l'istogramma è piatto:
    nessun candidato sarebbe affidabile, si salta l'iterazione.
    """
    base_qc = shor_circuit(N, a, n_count)
    sim = _sim(noise_model)
    transpiled = transpile(base_qc, sim, optimization_level=2)
    for iteration in range(1, max_iter + 1):
        counts = sim.run(transpiled, shots=shots,
                         seed_simulator=seed * 10000 + iteration).result().get_counts()
        feature = np.zeros(2 ** n_count)
        for k, v in counts.items():
            feature[int(k, 2)] = v / shots
        if classifier.predict([feature])[0] == 0:
            continue  # Istogramma troppo rumoroso: salta iterazione
        # Prova i top_k candidati più frequenti
        sorted_meas = sorted(counts.items(), key=lambda x: x[1], reverse=True)
        for meas_str, _ in sorted_meas[:top_k]:
            p, q = extract_factors(int(meas_str, 2), n_count, N, a)
            if p is not None:
                return {'factors': (p, q), 'iterations': iteration, 'success': True}
    return {'factors': (None, None), 'iterations': max_iter, 'success': False}
