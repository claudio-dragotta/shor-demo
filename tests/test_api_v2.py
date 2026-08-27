"""Contract tests for the three scientifically validated v3 experiment instances."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from server import ExperimentRequest, NoiseConfig, _SIMULATION_SLOT, app


client = TestClient(app)


def _payload(**overrides):
    payload = {"shots": 10, "seed": 20260818, "noise": {}}
    payload.update(overrides)
    return payload


@pytest.mark.parametrize(
    ("field", "value"),
    [("a", 2), ("n_count", 10)],
)
def test_base_and_count_register_are_server_side_and_cannot_be_overridden(
    field: str, value: int
) -> None:
    response = client.post("/api/experiment", json=_payload(**{field: value}))

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("N", "a", "n_count", "order", "num_qubits", "bloch_ok"),
    [(15, 7, 8, 4, 12, True), (21, 2, 10, 6, 22, False), (35, 6, 12, 2, 26, False)],
)
def test_all_validated_instances_are_exposed_with_server_side_parameters(
    N: int, a: int, n_count: int, order: int, num_qubits: int, bloch_ok: bool
) -> None:
    factor = client.get("/api/factor", params={"N": N})

    assert factor.status_code == 200
    body = factor.json()
    assert (body["N"], body["a"], body["n_count"], body["order"]) == (
        N, a, n_count, order
    )
    assert body["num_qubits"] == num_qubits
    assert body["bloch_ok"] is bloch_ok
    assert body["validated"] is True


def test_large_instance_uses_exact_sample_instead_of_exponential_bloch_view() -> None:
    bloch = client.get(
        "/api/bloch", params={"N": 21, "a": 2, "n_count": 10, "stage": 0}
    )
    sample = client.get("/api/ideal-sample", params={"N": 21, "seed": 42})

    assert bloch.status_code == 400
    assert sample.status_code == 200
    assert sample.json()["source"] == "exact_finite_register_qpe_law"
    assert len(sample.json()["measured_shot"]["bits"]) == 10


@pytest.mark.parametrize("N", [14, 33, 91])
def test_non_validated_instances_are_rejected(N: int) -> None:
    assert client.get("/api/factor", params={"N": N}).status_code == 400
    assert client.post("/api/experiment", json=_payload(N=N)).status_code == 422


@pytest.mark.parametrize("N", [21, 35])
def test_large_instance_live_budget_is_enforced(N: int) -> None:
    assert client.post("/api/experiment", json=_payload(N=N, shots=129)).status_code == 422


def test_n21_quantum_noise_is_rejected_before_starting_the_costly_worker() -> None:
    response = client.post(
        "/api/experiment", json=_payload(N=21, noise={"eps_1q": 0.001})
    )

    assert response.status_code == 422
    assert "non e' disponibile live" in response.text


def test_n21_readout_noise_remains_live() -> None:
    response = client.post(
        "/api/experiment",
        json=_payload(N=21, noise={"readout_0to1": 0.02, "readout_1to0": 0.02}),
    )

    assert response.status_code == 200, response.text
    assert response.json()["metadata"]["live_noise_scope"] == "readout_only"


def test_n35_coherent_noise_and_oversized_quantum_run_are_rejected_early() -> None:
    coherent = client.post(
        "/api/experiment",
        json=_payload(N=35, noise={"coherent_overrotation_deg": 1.0}),
    )
    oversized = client.post(
        "/api/experiment", json=_payload(N=35, shots=64, noise={"eps_2q": 0.001})
    )

    assert coherent.status_code == 422
    assert oversized.status_code == 422
    assert "sovrarotazione coerente" in coherent.text
    assert "al massimo 32 shot" in oversized.text


def test_costly_legacy_run_endpoint_is_not_public() -> None:
    response = client.get(
        "/api/run",
        params={"N": 15, "a": 7, "n_count": 8, "noise": "none", "shots": 10},
    )

    assert response.status_code == 404


@pytest.mark.parametrize("shots", [9, 2049])
def test_shot_limits_are_enforced(shots: int) -> None:
    response = client.post("/api/experiment", json=_payload(shots=shots))

    assert response.status_code == 422


@pytest.mark.parametrize("seed", [-1, 2_147_483_648])
def test_seed_must_fit_the_supported_nonnegative_31_bit_range(seed: int) -> None:
    response = client.post("/api/experiment", json=_payload(seed=seed))

    assert response.status_code == 422


@pytest.mark.parametrize("seed", [0, 2_147_483_647])
def test_seed_boundaries_are_accepted_by_schema(seed: int) -> None:
    request = ExperimentRequest.model_validate(_payload(seed=seed))

    assert request.seed == seed


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("eps_1q", -0.000001),
        ("eps_1q", 1.000001),
        ("eps_2q", -0.000001),
        ("eps_2q", 1.000001),
        ("readout_0to1", -0.000001),
        ("readout_0to1", 1.000001),
        ("readout_1to0", -0.000001),
        ("readout_1to0", 1.000001),
        ("coherent_overrotation_deg", -180.000001),
        ("coherent_overrotation_deg", 180.000001),
    ],
)
def test_noise_probability_and_angle_ranges_are_enforced(
    field: str, value: float
) -> None:
    response = client.post(
        "/api/experiment", json=_payload(noise={field: value})
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "noise",
    [
        {"t1_us": 100.0},
        {"t2_us": 80.0},
        {"t1_us": 0.0, "t2_us": 0.0},
        {"t1_us": -1.0, "t2_us": 1.0},
        {"t1_us": 100.0, "t2_us": 200.000001},
    ],
)
def test_relaxation_times_are_paired_positive_and_physically_consistent(
    noise: dict[str, float]
) -> None:
    response = client.post("/api/experiment", json=_payload(noise=noise))

    assert response.status_code == 422


def test_physical_t2_boundary_is_accepted_by_schema() -> None:
    noise = NoiseConfig.model_validate({"t1_us": 100.0, "t2_us": 200.0})

    assert noise.t2_us == 2 * noise.t1_us


def test_frontend_integer_thermal_values_are_accepted() -> None:
    # Gli slider JS serializzano 100 e 80 come numeri JSON interi.
    noise = NoiseConfig.model_validate({"t1_us": 100, "t2_us": 80})

    assert noise.t1_us == pytest.approx(100.0)
    assert noise.t2_us == pytest.approx(80.0)


@pytest.mark.parametrize(
    "invalid_noise",
    ["uc1", 42, {"preset": "uc1"}, {"unknown_channel": 0.1}],
)
def test_invalid_or_legacy_noise_shapes_are_rejected(invalid_noise) -> None:
    response = client.post(
        "/api/experiment", json=_payload(noise=invalid_noise)
    )

    assert response.status_code == 422


@pytest.mark.parametrize("value", [True, "0.1"])
def test_noise_numbers_are_not_coerced_from_bool_or_string(value) -> None:
    response = client.post(
        "/api/experiment", json=_payload(noise={"eps_1q": value})
    )

    assert response.status_code == 422


def test_bloch_measurement_seed_is_reproducible() -> None:
    params = {"N": 15, "a": 7, "n_count": 8, "stage": 5, "seed": 42}
    first = client.get("/api/bloch", params=params)
    second = client.get("/api/bloch", params=params)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["measurement_seed"] == 42
    assert first.json()["measured_shot"] == second.json()["measured_shot"]


def test_second_simulation_is_rejected_instead_of_queued() -> None:
    assert _SIMULATION_SLOT.acquire(blocking=False)
    try:
        response = client.post("/api/experiment", json=_payload())
    finally:
        _SIMULATION_SLOT.release()

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "5"


def test_zero_noise_is_exactly_the_same_sampled_baseline() -> None:
    response = client.post("/api/experiment", json=_payload(noise={}))

    assert response.status_code == 200
    body = response.json()
    assert body["noisy"]["memory"] == body["ideal"]["memory"]
    assert body["comparison"]["tvd"] == pytest.approx(0.0)
    assert body["comparison"]["hellinger_distance"] == pytest.approx(0.0)
    assert body["comparison"]["factor_yield_delta_ci"] == {
        "low": 0.0,
        "high": 0.0,
        "confidence": 1.0,
        "method": "exact_same_sample_zero_noise",
    }
    assert body["metadata"]["simulation_seeds"]["noisy"] is None


@pytest.mark.parametrize(
    ("N", "a", "n_count", "factors"),
    [(21, 2, 10, [3, 7]), (35, 6, 12, [5, 7])],
)
def test_large_validated_instances_execute_live_end_to_end(
    N: int, a: int, n_count: int, factors: list[int]
) -> None:
    response = client.post("/api/experiment", json=_payload(N=N, noise={}))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schema_version"] == "3.0"
    assert (body["config"]["N"], body["config"]["a"], body["config"]["n_count"]) == (
        N, a, n_count
    )
    assert len(body["ideal"]["distribution"]) == 2 ** n_count
    assert body["ideal"]["memory"] == body["noisy"]["memory"]
    assert body["comparison"]["tvd"] == pytest.approx(0.0)
    observed = body["ideal"]["factors_found"]
    if observed is not None:
        assert sorted(observed) == factors


def test_deterministic_readout_flip_uses_an_independent_reproducible_stream() -> None:
    response = client.post(
        "/api/experiment",
        json=_payload(noise={"readout_0to1": 1.0, "readout_1to0": 1.0}),
    )

    assert response.status_code == 200
    body = response.json()
    # Il circuito ideale ha supporto sui quattro picchi esatti; il readout al
    # 100% li porta sui quattro complementi, usando però un campione indipendente.
    complements = {
        format(255 - value, "08b") for value in (0, 64, 128, 192)
    }
    assert set(body["noisy"]["memory"]) <= complements
    assert body["comparison"]["tvd"] == pytest.approx(1.0)
    assert body["comparison"]["hellinger_distance"] == pytest.approx(1.0)
    seeds = body["metadata"]["simulation_seeds"]
    assert seeds["independent_streams"] is True
    assert seeds["ideal"] != seeds["noisy"]


def test_experiment_smoke_returns_complete_and_coherent_factor_results() -> None:
    """One deliberately small noisy run exercises serialization and core invariants."""

    payload = _payload(noise={"readout_0to1": 0.01, "readout_1to0": 0.02})
    response = client.post("/api/experiment", json=payload)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schema_version"]
    assert body["config"]["N"] == 15
    assert body["config"]["a"] == 7
    assert body["config"]["n_count"] == 8
    assert body["config"]["shots"] == 10
    assert body["config"]["seed"] == payload["seed"]
    assert body["random_factor_floor"] == pytest.approx(63 / 256)
    assert body["metadata"]["theoretical_peaks"] == [0, 64, 128, 192]
    assert body["metadata"]["useful_peaks"] == [64, 128, 192]
    assert body["metadata"]["circuit_implementation"] == "n15-a7-textbook-orbit-v3"
    assert body["metadata"]["simulation_seeds"]["independent_streams"] is True
    assert body["metadata"]["circuit"]["seed_transpiler"] == 20260819

    for mode in ("ideal", "noisy"):
        result = body[mode]
        assert result["shots"] == 10
        assert 0 <= result["n_ok"] <= result["shots"]
        assert result["factor_yield"] == pytest.approx(
            result["n_ok"] / result["shots"]
        )
        assert len(result["memory"]) == result["shots"]
        assert len(result["iterations"]) == result["shots"]
        assert result["iterations_shown"] == result["shots"]

        distribution = result["distribution"]
        assert len(distribution) == 256
        assert [record["value"] for record in distribution] == list(range(256))
        assert sum(record["count"] for record in distribution) == result["shots"]
        assert sum(
            record["count"]
            for record in distribution
            if record["factor_success"]
        ) == result["n_ok"]

        factors = result["factors_found"]
        assert (factors is not None) == (result["n_ok"] > 0)
        if factors is not None:
            assert sorted(factors) == [3, 5]
            assert factors[0] * factors[1] == body["config"]["N"]
            assert 1 <= result["found_at"] <= result["shots"]
        else:
            assert result["found_at"] is None

    comparison = body["comparison"]
    expected_delta = body["noisy"]["factor_yield"] - body["ideal"]["factor_yield"]
    assert comparison["factor_yield_delta"] == pytest.approx(expected_delta)
    assert comparison["factor_yield_delta_ci"]["low"] <= expected_delta
    assert comparison["factor_yield_delta_ci"]["high"] >= expected_delta
