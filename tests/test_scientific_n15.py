"""Scientific regression tests for the only instance exposed by the live web demo.

These tests deliberately avoid Monte Carlo sampling: the ideal QPE distribution is
calculated from the statevector, so failures are deterministic and reproducible.
"""

from __future__ import annotations

from functools import cache
from math import isclose

import pytest
from qiskit.quantum_info import Statevector

from qiskit import QuantumCircuit

from shor_core import c_amod15, extract_factors, shor_circuit


N = 15
A = 7
N_COUNT = 8
IDEAL_PEAKS = {0, 64, 128, 192}


def _reverse_four_bits(value: int) -> int:
    """Converte tra intero logico e convenzione little-endian del gate textbook."""
    return int(f"{value:04b}"[::-1], 2)


def _controlled_multiply_output(*, control: int, value: int, power: int = 1) -> int:
    circuit = QuantumCircuit(5)
    if control:
        circuit.x(0)
    physical_value = _reverse_four_bits(value)
    for qubit in range(4):
        if (physical_value >> qubit) & 1:
            circuit.x(qubit + 1)
    circuit.append(c_amod15(A, power), range(5))
    probabilities = Statevector.from_instruction(circuit).probabilities()
    output_index = int(probabilities.argmax())
    assert probabilities[output_index] == pytest.approx(1.0, abs=1e-12)
    return _reverse_four_bits(output_index >> 1)


@pytest.mark.parametrize("value", range(16))
def test_control_zero_leaves_every_work_basis_state_unchanged(value: int) -> None:
    assert _controlled_multiply_output(control=0, value=value) == value


@pytest.mark.parametrize("power", [1, 2, 4, 8])
@pytest.mark.parametrize("value", range(1, N))
def test_controlled_gate_really_multiplies_by_seven_modulo_fifteen(
    value: int, power: int
) -> None:
    expected = (pow(A, power, N) * value) % N

    assert _controlled_multiply_output(
        control=1, value=value, power=power
    ) == expected


def test_work_register_follows_the_expected_order_four_orbit() -> None:
    orbit = [1]
    for _ in range(4):
        orbit.append(_controlled_multiply_output(control=1, value=orbit[-1]))

    assert orbit == [1, 7, 4, 13, 1]


@cache
def _ideal_count_distribution() -> dict[int, float]:
    circuit = shor_circuit(N, A, N_COUNT).remove_final_measurements(inplace=False)
    state = Statevector.from_instruction(circuit)
    return {
        int(bitstring, 2): float(probability)
        for bitstring, probability in state.probabilities_dict(
            qargs=range(N_COUNT)
        ).items()
        if probability > 1e-12
    }


def test_ideal_n15_distribution_has_exactly_four_period_peaks() -> None:
    distribution = _ideal_count_distribution()

    assert set(distribution) == IDEAL_PEAKS
    assert sum(distribution.values()) == pytest.approx(1.0, abs=1e-12)
    for peak in IDEAL_PEAKS:
        assert distribution[peak] == pytest.approx(0.25, abs=1e-12)


def test_n15_ideal_single_shot_factor_yield_is_three_quarters() -> None:
    distribution = _ideal_count_distribution()
    factor_yield = sum(
        probability
        for outcome, probability in distribution.items()
        if extract_factors(outcome, N_COUNT, N, A) == (3, 5)
    )

    # y=0 is a legitimate QPE peak but cannot provide a period; the other three do.
    assert factor_yield == pytest.approx(0.75, abs=1e-12)


def test_postprocessing_recovers_factors_from_useful_ideal_peaks() -> None:
    assert extract_factors(0, N_COUNT, N, A) == (None, None)
    for outcome in (64, 128, 192):
        p, q = extract_factors(outcome, N_COUNT, N, A)
        assert {p, q} == {3, 5}
        assert p * q == N


def test_uniform_random_factor_floor_is_63_over_256() -> None:
    successful_outcomes = []
    for outcome in range(2**N_COUNT):
        p, q = extract_factors(outcome, N_COUNT, N, A)
        if p is not None and q is not None and p * q == N:
            successful_outcomes.append(outcome)

    assert len(successful_outcomes) == 63
    assert len(successful_outcomes) / 2**N_COUNT == pytest.approx(63 / 256)
    assert isclose(100 * 63 / 256, 24.609375)
