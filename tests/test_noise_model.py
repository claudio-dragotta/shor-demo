"""Regression tests for the explicitly illustrative hardware assumptions."""

from experiment_backend import build_illustrative_noise_model


def _config(**overrides):
    config = {
        "eps_1q": 0.0,
        "eps_2q": 0.0,
        "t1_us": None,
        "t2_us": None,
        "readout_0to1": 0.0,
        "readout_1to0": 0.0,
        "coherent_overrotation_deg": 0.0,
    }
    config.update(overrides)
    return config


def test_one_qubit_errors_leave_virtual_rz_untouched() -> None:
    model = build_illustrative_noise_model(
        _config(eps_1q=0.001, coherent_overrotation_deg=1.0)
    )

    assert set(model.noise_instructions) == {"sx", "x"}


def test_two_qubit_depolarization_targets_only_cx() -> None:
    model = build_illustrative_noise_model(_config(eps_2q=0.01))

    assert set(model.noise_instructions) == {"cx"}
