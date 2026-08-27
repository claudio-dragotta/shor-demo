"""Circuiti QPE locali usati dalla demo e dalle regressioni scientifiche.

N=15 usa il moltiplicatore textbook; N=21/35 usano l'aritmetica Beauregard validata. La demo
web v3 espone tutte e tre le istanze con un limite di shot più stretto per N=21/35.
"""
import numpy as np
from math import gcd, ceil, log2
from fractions import Fraction
from qiskit import QuantumCircuit
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
        # 21.036 CX e profondita' 23.081. Quel conteggio e' della diagnostica della
        # tesi: la demo usa n_count=10 per N=21, quindi un circuito piu' grande.
        # Il proxy indipendente di nessun evento 2Q e' soltanto
        # (1-15*lambda_2q/16)^21036 = 2,698687974e-09 per lambda_2q=0,001: non e'
        # una probabilita' di successo, una fedelta' o una misura della QPE.
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
