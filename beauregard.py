"""Controlled modular multiplication via the Draper/Beauregard construction.

Implementa U|x> = |a*x mod N> con O(n^3) porte CX invece di O(4^n) di UnitaryGate.

Convenzioni dei registri pubblici ``x`` e ``b``: big-endian, come nel chiamante
``shor_core.shor_circuit`` (l'ultimo qubit di ``x`` e' il bit meno significativo e viene
inizializzato a uno). I piccoli circuiti di Fourier usano invece la convenzione locale
little-endian di Qiskit; ``_c_mult_mod_N`` effettua esplicitamente l'inversione della lista
dei qubit quando li compone sul registro ``b``.

Riferimento primario: S. Beauregard, "Circuit for Shor's algorithm using 2n+3 qubits",
Quantum Information and Computation 3(2), 175-185 (2003), arXiv:quant-ph/0205095v3.
"""
import numpy as np
from math import ceil, gcd, log2
from qiskit import QuantumCircuit
from qiskit.synthesis import synth_qft_full


BEAUREGARD_REVISION = "beauregard-c-amod-v2-endian-clean-ancilla"


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
    # Qiskit usa q[0] come LSB. Con QFT(do_swaps=False), il qubit locale j
    # riceve la fase 2*pi*a/2^(j+1); usare n-j scambia LSB e MSB e non
    # implementa un adder (produce una sovrapposizione anche su input di base).
    for j in range(n):
        angle = sign * 2 * np.pi * a / (2 ** (j + 1))
        qc.p(angle, j)
    return qc


def _qft(n, inverse=False):
    return synth_qft_full(n, do_swaps=False, inverse=inverse)


def _cc_phi_add(n, a, inverse=False):
    """
    Doubly-controlled Draper adder.
    Qubits: [ctrl1, ctrl2, b[0..n-1]] con b little-endian (totale n+2).
    Decomposizione C^2P: CP(a/2)+CX+CP(-a/2)+CX+CP(a/2) per ogni qubit.
    CX count: 2n per n qubit di b.
    """
    qc = QuantumCircuit(n + 2, name=f'ccphiADD({a})' + ('†' if inverse else ''))
    c1, c2 = 0, 1
    b = list(range(2, n + 2))
    sign = -1 if inverse else 1
    for j in range(n):
        angle = sign * 2 * np.pi * a / (2 ** (j + 1))
        qc.cp(angle / 2, c1, b[j])
        qc.cx(c1, c2)
        qc.cp(-angle / 2, c2, b[j])
        qc.cx(c1, c2)
        qc.cp(angle / 2, c2, b[j])
    return qc


def _c_phi_add(n, a, inverse=False):
    """
    Singly-controlled Draper adder.
    Qubits: [ctrl, b[0..n-1]] con b little-endian (totale n+1).
    CX count: n (una CP per qubit).
    """
    qc = QuantumCircuit(n + 1, name=f'cphiADD({a})' + ('†' if inverse else ''))
    ctrl = 0
    b = list(range(1, n + 1))
    sign = -1 if inverse else 1
    for j in range(n):
        angle = sign * 2 * np.pi * a / (2 ** (j + 1))
        qc.cp(angle, ctrl, b[j])
    return qc


# ──────────────────────────────────────────────
# Modular adder (Beauregard Fig. 2)
# ──────────────────────────────────────────────

def _phi_add_mod_N(n_b, a, N):
    """
    Doubly-controlled phi_add mod N (Beauregard 2002, Fig. 2).
    Qubits: [ctrl1, ctrl2, b[0..n_b-1], ancilla] con b little-endian
    (totale n_b + 3).
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
    # 4. Il bit di segno/overflow e' l'MSB, cioe' b[-1] in little-endian.
    qc.cx(b[-1], anc)
    # 5. QFT: torna alla base di Fourier
    qc.compose(_qft(n_b),                      b,           inplace=True)
    # 6. c_phi_add(N, ctrl=anc): se overflow, ripristina
    qc.compose(_c_phi_add(n_b, N),             [anc] + b,   inplace=True)
    # 7. cc_phi_add(-a): scomputa step 1
    qc.compose(_cc_phi_add(n_b, a, inverse=True), [c1, c2] + b, inplace=True)
    # 8. QFT†: confronta direttamente (a+b) mod N con a (Beauregard eq. 1).
    # Non va inserito un +N: cambierebbe il predicato e romperebbe anche il
    # ramo con uno dei due controlli a zero.
    qc.compose(_qft(n_b, inverse=True),        b,           inplace=True)
    # 9. X; CNOT(MSB, anc); X: reset ancilla
    qc.x(b[-1])
    qc.cx(b[-1], anc)
    qc.x(b[-1])
    # 10. QFT
    qc.compose(_qft(n_b),                      b,           inplace=True)
    # 11. cc_phi_add(a): ripristina il risultato modulare
    qc.compose(_cc_phi_add(n_b, a),            [c1, c2] + b, inplace=True)
    return qc


# ──────────────────────────────────────────────
# Moltiplicazione modulare controllata
# ──────────────────────────────────────────────

def _c_mult_mod_N(n, a, N):
    """
    Controlled CMULT(a,N).
    Qubits: [ctrl, x[0..n-1], b[0..n], ancilla]  (totale 2n+3).
    I registri x e b di questa interfaccia sono big-endian; b[0] e' il bit extra
    di overflow e b[1:] contiene il valore su n bit.
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
    b_little_endian = list(reversed(b))

    qc.compose(_qft(n_b), b_little_endian, inplace=True)
    for j in range(n):
        # x[j] e' il bit di peso 2^(n-1-j) nel registro pubblico big-endian.
        a_shifted = (a * pow(2, n - 1 - j, N)) % N
        qc.compose(_phi_add_mod_N(n_b, a_shifted, N),
                   [ctrl, x[j]] + b_little_endian + [anc], inplace=True)
    qc.compose(_qft(n_b, inverse=True), b_little_endian, inplace=True)
    return qc


# ──────────────────────────────────────────────
# Gate controllato U^power (interfaccia pubblica)
# ──────────────────────────────────────────────

def beauregard_c_amod(a, N, power):
    """
    Gate controllato: |ctrl>|x> -> |ctrl>|a^power * x mod N>  (se ctrl=1).

    Struttura (Beauregard 2002):
      1. CMULT(a_pow, N) : accumula a_pow*x nel registro b
      2. Controlled SWAP(x, b[1..n]) : scambia x con i bit payload di b
      3. CMULT(a_inv, N)† : scomputa b

    Qubits: [ctrl, x[0..n-1], b[0..n], ancilla]
    Totale: 1 + n + (n+1) + 1 = 2n+3  con  n = ceil(log2(N+1))
    """
    if not isinstance(N, int) or N < 3:
        raise ValueError("N deve essere un intero >= 3.")
    if not isinstance(a, int) or not 1 <= a < N or gcd(a, N) != 1:
        raise ValueError("a deve soddisfare 1 <= a < N e gcd(a, N) = 1.")
    if not isinstance(power, int) or power < 1:
        raise ValueError("power deve essere un intero positivo.")

    n = ceil(log2(N + 1))
    n_b = n + 1
    a_pow = pow(a, power, N)
    a_inv = pow(a_pow, -1, N)

    total = 1 + n + n_b + 1
    qc = QuantumCircuit(total, name=f'{a}^{power} mod {N} [B]')
    qc.metadata = {
        "beauregard_revision": BEAUREGARD_REVISION,
        "register_endianness": "big",
        "fourier_local_endianness": "little",
    }
    ctrl = 0
    x = list(range(1, n + 1))
    b = list(range(n + 1, n + 1 + n_b))
    anc = n + 1 + n_b

    # Fase 1: CMULT(a_pow) -> b
    qc.compose(_c_mult_mod_N(n, a_pow, N), [ctrl] + x + b + [anc], inplace=True)

    # Fase 2: b[0] e' l'overflow (sempre zero); il prodotto vive in b[1:].
    for i in range(n):
        qc.cswap(ctrl, x[i], b[i + 1])

    # Fase 3: CMULT(a_inv)† per scomputare b
    qc.compose(_c_mult_mod_N(n, a_inv, N).inverse(),
               [ctrl] + x + b + [anc], inplace=True)
    return qc
