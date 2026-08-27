"""Minimal regression for the original Beauregard arithmetic corruption bug.

The former implementation mapped even ``ctrl=1, x=0`` to a broad superposition. This small
test is retained next to the exhaustive properties so the initial failure mode remains
immediately recognizable.
"""

from __future__ import annotations

from math import ceil, log2

import pytest
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

from beauregard import beauregard_c_amod


def test_beauregard_controlled_multiply_preserves_zero_and_ancillas() -> None:
    """With ctrl=1, multiplying x=0 mod 21 must leave one basis state only."""

    modulus = 21
    n = ceil(log2(modulus + 1))
    num_qubits = 2 * n + 3
    circuit = QuantumCircuit(num_qubits)
    circuit.x(0)  # control=1; x, b and ancilla remain zero
    circuit.append(beauregard_c_amod(2, modulus, 1), range(num_qubits))

    probabilities = Statevector.from_instruction(circuit).probabilities()
    expected_index = 1  # Qiskit little-endian basis index: only q0 is one.

    assert probabilities[expected_index] == pytest.approx(1.0, abs=1e-10)
    assert sum(probability > 1e-10 for probability in probabilities) == 1
