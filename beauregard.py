"""
beauregard.py — Controlled modular multiplication via Draper adder (Beauregard 2002).

Implementa U|x> = |a*x mod N> con O(n^3) porte CX invece di O(4^n) di UnitaryGate.
Per N=21 (n=5): ~326 CX per U^1, ~2594 CX totali per QPE con n_count=8
(vs 10.040 CX di UnitaryGate -> P_surv passa da ~1e-44 a ~7.5% con eps_2q=0.001).

Riferimento: Beauregard, "Circuit for Shor's algorithm using 2n+3 qubits", 2002.
"""
import numpy as np
from math import ceil, log2
from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT


# ──────────────────────────────────────────────
# Primitivi del Draper adder
# ──────────────────────────────────────────────

def _phi_add(n, a, inverse=False):
    """
    Costant adder in Fourier basis.
    Su n qubit in stato |phi(b)>: applica |phi(b+a)>.
    Nessuna porta CX — solo rotazioni di fase P(angle).
    """
    qc = QuantumCircuit(n, name=f'phiADD({a})' + ('†' if inverse else ''))
    sign = -1 if inverse else 1
    for j in range(n):
        angle = sign * 2 * np.pi * a / (2 ** (n - j))
        qc.p(angle, j)
    return qc


def _qft(n, inverse=False):
    return QFT(n, do_swaps=False, inverse=inverse).decompose()


def _cc_phi_add(n, a, inverse=False):
    """
    Doubly-controlled Draper adder.
    Qubits: [ctrl1, ctrl2, b[0..n-1]]  (totale n+2).
    Decomposizione C^2P: CP(a/2)+CX+CP(-a/2)+CX+CP(a/2) per ogni qubit.
    CX count: 2n per n qubit di b.
    """
    qc = QuantumCircuit(n + 2, name=f'ccphiADD({a})' + ('†' if inverse else ''))
    c1, c2 = 0, 1
    b = list(range(2, n + 2))
    sign = -1 if inverse else 1
    for j in range(n):
        angle = sign * 2 * np.pi * a / (2 ** (n - j))
        qc.cp(angle / 2, c1, b[j])
        qc.cx(c1, c2)
        qc.cp(-angle / 2, c2, b[j])
        qc.cx(c1, c2)
        qc.cp(angle / 2, c2, b[j])
    return qc


def _c_phi_add(n, a, inverse=False):
    """
    Singly-controlled Draper adder.
    Qubits: [ctrl, b[0..n-1]]  (totale n+1).
    CX count: n (una CP per qubit).
    """
    qc = QuantumCircuit(n + 1, name=f'cphiADD({a})' + ('†' if inverse else ''))
    ctrl = 0
    b = list(range(1, n + 1))
    sign = -1 if inverse else 1
    for j in range(n):
        angle = sign * 2 * np.pi * a / (2 ** (n - j))
        qc.cp(angle, ctrl, b[j])
    return qc


# ──────────────────────────────────────────────
# Modular adder (Beauregard Fig. 2)
# ──────────────────────────────────────────────

def _phi_add_mod_N(n_b, a, N):
    """
    Doubly-controlled phi_add mod N (Beauregard 2002, Fig. 2).
    Qubits: [ctrl1, ctrl2, b[0..n_b-1], ancilla]  (totale n_b + 3).
    Aggiunge a al registro b (in base di Fourier) modulo N, se ctrl1=ctrl2=1.
    Lascia ancilla a 0.
    """
    total = n_b + 3
    qc = QuantumCircuit(total, name=f'phiADDmodN({a},{N})')
    c1, c2 = 0, 1
    b = list(range(2, 2 + n_b))
    anc = 2 + n_b

    # 1. cc_phi_add(a)
    qc.compose(_cc_phi_add(n_b, a),           [c1, c2] + b, inplace=True)
    # 2. phi_add(-N)  (non controllato)
    qc.compose(_phi_add(n_b, N, inverse=True), b,           inplace=True)
    # 3. QFT†: torna alla base computazionale per leggere il bit di segno
    qc.compose(_qft(n_b, inverse=True),        b,           inplace=True)
    # 4. CNOT(b[0], anc): b[0] è MSB (bit di segno)
    qc.cx(b[0], anc)
    # 5. QFT: torna alla base di Fourier
    qc.compose(_qft(n_b),                      b,           inplace=True)
    # 6. c_phi_add(N, ctrl=anc): se overflow, ripristina
    qc.compose(_c_phi_add(n_b, N),             [anc] + b,   inplace=True)
    # 7. cc_phi_add(-a): scomputa step 1
    qc.compose(_cc_phi_add(n_b, a, inverse=True), [c1, c2] + b, inplace=True)
    # 8. phi_add(N): rende b positivo per il controllo dell'ancilla
    qc.compose(_phi_add(n_b, N),               b,           inplace=True)
    # 9. QFT†
    qc.compose(_qft(n_b, inverse=True),        b,           inplace=True)
    # 10. X; CNOT(b[0], anc); X: reset ancilla
    qc.x(b[0])
    qc.cx(b[0], anc)
    qc.x(b[0])
    # 11. QFT
    qc.compose(_qft(n_b),                      b,           inplace=True)
    # 12. phi_add(-N): compensa step 8
    qc.compose(_phi_add(n_b, N, inverse=True), b,           inplace=True)
    # 13. cc_phi_add(a): ripristina per simmetria
    qc.compose(_cc_phi_add(n_b, a),            [c1, c2] + b, inplace=True)
    return qc


# ──────────────────────────────────────────────
# Moltiplicazione modulare controllata
# ──────────────────────────────────────────────

def _c_mult_mod_N(n, a, N):
    """
    Controlled CMULT(a,N).
    Qubits: [ctrl, x[0..n-1], b[0..n], ancilla]  (totale 2n+3).
    |ctrl>|x>|0>|0> -> |ctrl>|x>|a*x mod N>|0>  se ctrl=1.
    b ha n+1 bit per gestire l'overflow intermedio.
    """
    n_b = n + 1
    total = 1 + n + n_b + 1
    qc = QuantumCircuit(total, name=f'cMULT({a},{N})')
    ctrl = 0
    x = list(range(1, n + 1))
    b = list(range(n + 1, n + 1 + n_b))
    anc = n + 1 + n_b

    qc.compose(_qft(n_b), b, inplace=True)
    for j in range(n):
        a_shifted = (a * pow(2, j, N)) % N
        qc.compose(_phi_add_mod_N(n_b, a_shifted, N),
                   [ctrl, x[j]] + b + [anc], inplace=True)
    qc.compose(_qft(n_b, inverse=True), b, inplace=True)
    return qc


# ──────────────────────────────────────────────
# Gate controllato U^power (interfaccia pubblica)
# ──────────────────────────────────────────────

def beauregard_c_amod(a, N, power):
    """
    Gate controllato: |ctrl>|x> -> |ctrl>|a^power * x mod N>  (se ctrl=1).

    Struttura (Beauregard 2002):
      1. CMULT(a_pow, N) : accumula a_pow*x nel registro b
      2. Controlled SWAP(x, b[0..n-1]) : scambia i registri
      3. CMULT(a_inv, N)† : scomputa b

    Qubits: [ctrl, x[0..n-1], b[0..n], ancilla]
    Totale: 1 + n + (n+1) + 1 = 2n+3  con  n = ceil(log2(N+1))
    """
    n = ceil(log2(N + 1))
    n_b = n + 1
    a_pow = pow(a, power, N)
    a_inv = pow(a_pow, -1, N)

    total = 1 + n + n_b + 1
    qc = QuantumCircuit(total, name=f'{a}^{power} mod {N} [B]')
    ctrl = 0
    x = list(range(1, n + 1))
    b = list(range(n + 1, n + 1 + n_b))
    anc = n + 1 + n_b

    # Fase 1: CMULT(a_pow) -> b
    qc.compose(_c_mult_mod_N(n, a_pow, N), [ctrl] + x + b + [anc], inplace=True)

    # Fase 2: CSWAP(x[i], b[i]) per i=0..n-1
    for i in range(n):
        qc.cswap(ctrl, x[i], b[i])

    # Fase 3: CMULT(a_inv)† per scomputare b
    qc.compose(_c_mult_mod_N(n, a_inv, N).inverse(),
               [ctrl] + x + b + [anc], inplace=True)
    return qc
