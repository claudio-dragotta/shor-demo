"""Scientific properties of the corrected Beauregard arithmetic.

The public multiplier registers use the big-endian convention expected by ``shor_core``.
The truth table is exhaustive on the valid modular domain ``0 <= x < N`` for every distinct
non-identity multiplier used by the N=21 and N=35 QPE circuits.  Aer MPS is used only as an
exact circuit simulator here (no sampling and no noise).
"""
from __future__ import annotations

import math

import numpy as np
import pytest
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

from beauregard import (
    BEAUREGARD_REVISION,
    _phi_add,
    _phi_add_mod_N,
    _qft,
    beauregard_c_amod,
)
from shor_core import shor_circuit


pytestmark = pytest.mark.filterwarnings("ignore:The class .*QFT.* is deprecated:DeprecationWarning")


def test_revision_contract_is_attached_to_the_public_circuit() -> None:
    circuit = beauregard_c_amod(2, 21, 1)
    assert BEAUREGARD_REVISION == "beauregard-c-amod-v2-endian-clean-ancilla"
    assert circuit.metadata == {
        "beauregard_revision": BEAUREGARD_REVISION,
        "register_endianness": "big",
        "fourier_local_endianness": "little",
    }


def _work_index(control: int, value: int, width: int) -> int:
    """Basis index with ctrl/x set and every b/ancilla qubit clean.

    x[0] is the MSB and x[width-1] the LSB. Qiskit's integer basis index is still
    little-endian with respect to physical qubit numbers.
    """
    index = int(control)
    for position in range(width):
        if (value >> (width - 1 - position)) & 1:
            index |= 1 << (1 + position)
    return index


def _prepare_basis(circuit: QuantumCircuit, control: int, value: int, width: int) -> None:
    if control:
        circuit.x(0)
    for position in range(width):
        if (value >> (width - 1 - position)) & 1:
            circuit.x(1 + position)


@pytest.mark.parametrize("constant", [1, 3, 7])
def test_fourier_constant_adder_little_endian_truth_table(constant: int) -> None:
    """Pin the Qiskit no-swap QFT phase order: local q[0] is the LSB."""
    width = 4
    adder = QuantumCircuit(width)
    adder.compose(_qft(width), range(width), inplace=True)
    adder.compose(_phi_add(width, constant), range(width), inplace=True)
    adder.compose(_qft(width, inverse=True), range(width), inplace=True)

    for value in range(2 ** width):
        circuit = QuantumCircuit(width)
        for bit in range(width):
            if (value >> bit) & 1:
                circuit.x(bit)
        circuit.compose(adder, range(width), inplace=True)
        circuit.save_statevector()
        actual = np.asarray(
            AerSimulator(method="statevector")
            .run(circuit)
            .result()
            .get_statevector()
        )
        expected = np.zeros(2 ** width, dtype=complex)
        expected[(value + constant) % (2 ** width)] = 1.0
        np.testing.assert_allclose(actual, expected, rtol=0.0, atol=2e-10)


def test_modular_adder_controls_and_ancilla_exhaustively() -> None:
    """Exercise Beauregard's compare/uncompute sequence independently of multiplication."""
    N, constant = 5, 2
    width = math.ceil(math.log2(N + 1)) + 1
    modular_adder = _phi_add_mod_N(width, constant, N)
    b_qubits = list(range(2, 2 + width))  # local little-endian register

    for controls in range(4):
        for value in range(N):
            circuit = QuantumCircuit(width + 3)
            if controls & 1:
                circuit.x(0)
            if controls & 2:
                circuit.x(1)
            for bit in range(width):
                if (value >> bit) & 1:
                    circuit.x(b_qubits[bit])
            circuit.compose(_qft(width), b_qubits, inplace=True)
            circuit.compose(modular_adder, range(width + 3), inplace=True)
            circuit.compose(_qft(width, inverse=True), b_qubits, inplace=True)
            circuit.save_probabilities_dict(range(width + 3), label="modular_truth")
            probabilities = (
                AerSimulator(method="matrix_product_state")
                .run(circuit)
                .result()
                .data(0)["modular_truth"]
            )

            expected_value = (value + constant) % N if controls == 3 else value
            expected_index = controls | (expected_value << 2)
            assert float(probabilities.get(expected_index, 0.0)) == pytest.approx(
                1.0, abs=2e-9
            )
            assert sum(
                float(probability)
                for index, probability in probabilities.items()
                if int(index) != expected_index
            ) < 2e-9


@pytest.mark.parametrize(
    ("N", "a", "power"),
    [
        (21, 2, 1),   # multiplier 2
        (21, 2, 2),   # multiplier 4
        (21, 2, 4),   # multiplier 16
        (35, 6, 1),   # multiplier 6 (all later QPE powers are identity)
    ],
)
def test_controlled_multiplier_full_truth_table_and_clean_ancillas(
    N: int, a: int, power: int
) -> None:
    """Check both control branches and every x in the modular domain."""
    width = math.ceil(math.log2(N + 1))
    multiplier = pow(a, power, N)
    gate = beauregard_c_amod(a, N, power)
    circuits = []
    expected_indices = []

    for control in (0, 1):
        for value in range(N):
            circuit = QuantumCircuit(gate.num_qubits)
            _prepare_basis(circuit, control, value, width)
            circuit.compose(gate, range(gate.num_qubits), inplace=True)
            circuit.save_probabilities_dict(
                range(gate.num_qubits), label="basis_probabilities"
            )
            circuits.append(circuit)
            expected_value = multiplier * value % N if control else value
            expected_indices.append(_work_index(control, expected_value, width))

    simulator = AerSimulator(method="matrix_product_state", max_parallel_experiments=0)
    result = simulator.run(circuits).result()
    assert result.success

    for experiment, expected_index in enumerate(expected_indices):
        probabilities = result.data(experiment)["basis_probabilities"]
        target_probability = float(probabilities.get(expected_index, 0.0))
        other_probability = sum(
            float(probability)
            for index, probability in probabilities.items()
            if int(index) != expected_index
        )
        assert target_probability == pytest.approx(1.0, abs=2e-9)
        assert other_probability < 2e-9


@pytest.mark.parametrize(
    ("N", "a", "power"),
    [(21, 2, 1), (21, 2, 2), (21, 2, 4), (35, 6, 1)],
)
def test_controlled_multiplier_preserves_relative_phase(
    N: int, a: int, power: int
) -> None:
    """A correct truth-table permutation must not hide x-dependent phases."""
    width = math.ceil(math.log2(N + 1))
    gate = beauregard_c_amod(a, N, power)
    multiplier = pow(a, power, N)
    dimension = 2 ** gate.num_qubits
    initial = np.zeros(dimension, dtype=complex)
    expected = np.zeros(dimension, dtype=complex)
    amplitude = 1.0 / math.sqrt(2 * N)

    for control in (0, 1):
        for value in range(N):
            initial[_work_index(control, value, width)] = amplitude
            expected_value = multiplier * value % N if control else value
            expected[_work_index(control, expected_value, width)] = amplitude

    circuit = QuantumCircuit(gate.num_qubits)
    circuit.set_statevector(initial)
    circuit.compose(gate, range(gate.num_qubits), inplace=True)
    circuit.save_statevector(label="final_state")
    simulator = AerSimulator(method="matrix_product_state")
    actual = np.asarray(simulator.run(circuit).result().data(0)["final_state"])

    np.testing.assert_allclose(actual, expected, rtol=0.0, atol=2e-8)


def _ideal_qpe_distribution(num_count_qubits: int, order: int) -> np.ndarray:
    """Exact finite-register QPE law, averaged over the order eigenphases."""
    dimension = 2 ** num_count_qubits
    probabilities = np.zeros(dimension, dtype=float)
    for measured in range(dimension):
        for eigenphase_index in range(order):
            delta = eigenphase_index / order - measured / dimension
            denominator = math.sin(math.pi * delta)
            if abs(denominator) < 1e-14:
                geometric_sum_squared = dimension ** 2
            else:
                geometric_sum_squared = (
                    math.sin(math.pi * dimension * delta) / denominator
                ) ** 2
            probabilities[measured] += geometric_sum_squared / (
                order * dimension ** 2
            )
    return probabilities


@pytest.mark.parametrize(
    ("N", "a", "n_count", "order"),
    [(21, 2, 10, 6), (35, 6, 12, 2)],
)
def test_end_to_end_qpe_matches_exact_order_finding_distribution(
    N: int, a: int, n_count: int, order: int
) -> None:
    """Validate initialization, endian mapping, all controlled powers and inverse QFT."""
    circuit = shor_circuit(N, a, n_count).remove_final_measurements(inplace=False)
    circuit.save_probabilities_dict(range(n_count), label="count_probabilities")
    simulator = AerSimulator(method="matrix_product_state")
    compiled = transpile(
        circuit, simulator, optimization_level=2, seed_transpiler=20260819
    )
    observed_dict = simulator.run(compiled).result().data(0)["count_probabilities"]
    observed = np.array(
        [float(observed_dict.get(value, 0.0)) for value in range(2 ** n_count)]
    )
    expected = _ideal_qpe_distribution(n_count, order)

    total_variation_distance = 0.5 * np.abs(observed - expected).sum()
    assert observed.sum() == pytest.approx(1.0, abs=2e-9)
    assert total_variation_distance < 2e-8
