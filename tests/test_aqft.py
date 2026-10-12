"""Test della QFT approssimata (scheda 03 della demo).

Non basta che il codice giri: ogni blocco confronta il circuito con un riferimento
indipendente -- la QFT di Qiskit, la DFT scritta a mano, la legge QPE in forma chiusa,
una simulazione esatta a matrice densita', il laboratorio del rumore, gli artefatti M15.

  A  operatore QFT inversa troncata, da solo
  B  circuito di Shor N=15 senza rumore
  C  fuori da N=15: dove l'AQFT deve costare resa
  D  rumore
  E  API
  F  dati della tesi

I test marcati ``slow`` usano la matrice densita' completa (12 qubit) e durano minuti:
``pytest -m "not slow"`` li salta.
"""
from __future__ import annotations

import itertools
import json
import math
import os
import random

import numpy as np
import pytest
from fastapi.testclient import TestClient
from qiskit.circuit.library import QFTGate
from qiskit.quantum_info import Operator, Statevector

import aqft_backend as A
import api_backend as api
import shor_core
from experiment_backend import build_illustrative_noise_model
from server import _SIMULATION_SLOT, app
from shor_general import extract_factors

client = TestClient(app)
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

UC1 = {"eps_1q": 0.001, "eps_2q": 0.01, "t1_us": 100.0, "t2_us": 80.0,
       "readout_0to1": 0.02, "readout_1to0": 0.02, "coherent_overrotation_deg": 0.0}
UC2 = {"eps_1q": 0.005, "eps_2q": 0.05, "t1_us": 50.0, "t2_us": 30.0,
       "readout_0to1": 0.05, "readout_1to0": 0.05, "coherent_overrotation_deg": 0.0}
ZERO = dict(api.ZERO_NOISE)


# ---------------------------------------------------------------------------
# utilita'
# ---------------------------------------------------------------------------
def kept_rotations(n: int, k: int) -> int:
    return sum(n - d for d in range(1, n) if d <= k)


def removed_angles(n: int, k: int) -> list[float]:
    return [math.pi / 2 ** d for d in range(k + 1, n) for _ in range(n - d)]


def qpe_input_state(n: int, phi: float) -> Statevector:
    """Registro di conteggio dopo le potenze controllate, per un autostato di fase phi.

    Il qubit j porta la fase 2*pi*phi*2^j (convenzione di shor_core: il qubit j controlla
    U^(2^j)). np.kron mette il primo fattore sul bit piu' significativo.
    """
    vec = np.array([1.0 + 0j])
    for j in reversed(range(n)):
        vec = np.kron(vec, np.array([1.0, np.exp(2j * np.pi * phi * 2 ** j)]) / math.sqrt(2))
    return Statevector(vec)


def qpe_distribution(n: int, k: int, phases: list[float]) -> np.ndarray:
    """Distribuzione del registro mediata su autofasi equiprobabili, come in Shor."""
    U = Operator(A.inverse_qft_approx(n, k))
    out = np.zeros(2 ** n)
    for phi in phases:
        out += qpe_input_state(n, phi).evolve(U).probabilities()
    return out / len(phases)


def tvd(p, q) -> float:
    return 0.5 * float(np.abs(np.asarray(p) - np.asarray(q)).sum())


def factor_yield(dist, n: int, N: int, a: int) -> float:
    total = 0.0
    for y, p in enumerate(dist):
        f1, f2 = extract_factors(y, n, N, a)
        if f1 is not None and f2 is not None and f1 * f2 == N:
            total += p
    return total


def apply_readout(dist: np.ndarray, n: int, p01: float, p10: float) -> np.ndarray:
    """Errore di readout indipendente su ogni bit, applicato in forma esatta."""
    M = np.array([[1 - p01, p10], [p01, 1 - p10]])  # colonne: bit vero 0/1
    t = np.asarray(dist, dtype=float).reshape([2] * n)
    for axis in range(n):
        t = np.moveaxis(np.tensordot(M, t, axes=([1], [axis])), 0, axis)
    return t.reshape(-1)


def wilson(s: int, n: int, z: float = 1.959963984540054):
    p = s / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def exact_noisy_distribution(k: int, noise: dict) -> np.ndarray:
    """Distribuzione esatta del registro sotto rumore: matrice densita' + readout analitico.

    Il transpiler assorbe gli SWAP rimappando le misure: il qubit q non finisce nel bit q.
    La mappa si ricostruisce dalle istruzioni di misura del circuito compilato.
    """
    from qiskit_aer import AerSimulator

    gate_noise = {**noise, "readout_0to1": 0.0, "readout_1to0": 0.0}
    sim = AerSimulator(method="density_matrix", noise_model=build_illustrative_noise_model(gate_noise))
    c = A.compiled_circuit(k)
    mappa = {c.find_bit(i.clbits[0]).index: c.find_bit(i.qubits[0]).index
             for i in c.data if i.operation.name == "measure"}
    qc = c.remove_final_measurements(inplace=False)
    qc.save_probabilities([mappa[b] for b in range(A.N_COUNT)])
    p = np.asarray(sim.run(qc).result().data()["probabilities"])
    return apply_readout(p, A.N_COUNT, noise["readout_0to1"], noise["readout_1to0"])


# ===========================================================================
# A. Operatore QFT inversa troncata
# ===========================================================================
@pytest.mark.parametrize("n", range(1, 9))
def test_A01_grado_pieno_coincide_con_shor_core(n):
    k = max(1, n - 1)
    assert Operator(A.inverse_qft_approx(n, k)).equiv(Operator(shor_core.inverse_qft(n)))


@pytest.mark.parametrize("n", range(1, 9))
def test_A02_grado_pieno_coincide_con_qft_di_qiskit_e_con_la_dft(n):
    U = Operator(A.inverse_qft_approx(n, max(1, n - 1))).data
    assert np.allclose(U, Operator(QFTGate(n)).data.conj().T, atol=1e-12)
    N = 2 ** n
    w = np.exp(2j * np.pi / N)
    F_inv = np.array([[w ** (-x * y) for x in range(N)] for y in range(N)]) / math.sqrt(N)
    assert np.allclose(U, F_inv, atol=1e-12)


@pytest.mark.parametrize("n,k", [(n, k) for n in range(2, 9) for k in range(1, n)])
def test_A03_unitaria_per_ogni_grado(n, k):
    U = Operator(A.inverse_qft_approx(n, k)).data
    assert np.allclose(U @ U.conj().T, np.eye(2 ** n), atol=1e-12)


@pytest.mark.parametrize("n,k", [(n, k) for n in range(2, 11) for k in range(1, n + 2)])
def test_A04_struttura_porte_conteggi_e_angoli(n, k):
    qc = A.inverse_qft_approx(n, k)
    ops = qc.count_ops()
    assert set(ops) <= {"swap", "cp", "h"}
    assert ops.get("h", 0) == n
    assert ops.get("swap", 0) == n // 2
    assert ops.get("cp", 0) == kept_rotations(n, min(k, n - 1))
    for inst in qc.data:
        if inst.operation.name != "cp":
            continue
        m, j = sorted(qc.find_bit(q).index for q in inst.qubits)
        d = j - m
        assert 1 <= d <= k
        assert math.isclose(float(inst.operation.params[0]), -math.pi / 2 ** d, rel_tol=0, abs_tol=1e-15)


def test_A05_grado_oltre_il_massimo_equivale_alla_piena():
    for n in range(2, 9):
        assert Operator(A.inverse_qft_approx(n, n + 5)).equiv(Operator(A.inverse_qft_approx(n, n - 1)))


@pytest.mark.parametrize("k", [0, -1, -7])
def test_A06_grado_non_positivo_rifiutato(k):
    with pytest.raises(ValueError):
        A.inverse_qft_approx(8, k)


@pytest.mark.parametrize("n", range(3, 9))
def test_A07_errore_operatoriale_monotono_e_sotto_il_limite_rigoroso(n):
    """||U_k - U_piena|| <= somma su ogni rotazione tolta di |1 - e^{i theta}|.

    Vale per telescopio: togliere una cp diagonale cambia l'operatore di al piu'
    ||cp - I|| = |1 - e^{i theta}| = 2 sin(theta/2).
    """
    full = Operator(A.inverse_qft_approx(n, n - 1)).data
    prev = math.inf
    for k in range(1, n):
        err = np.linalg.norm(Operator(A.inverse_qft_approx(n, k)).data - full, 2)
        bound = sum(2 * math.sin(t / 2) for t in removed_angles(n, k))
        assert err <= bound + 1e-12
        assert err <= prev + 1e-12
        prev = err
    assert prev < 1e-12


@pytest.mark.parametrize("n", [4, 6, 8])
def test_A08_tvd_degli_esiti_limitata_dall_errore_operatoriale(n):
    """Su stati qualsiasi la TVD fra gli esiti non supera ||U_k - U_piena||."""
    rng = np.random.default_rng(20261011 + n)
    full = Operator(A.inverse_qft_approx(n, n - 1))
    for k in range(1, n):
        Uk = Operator(A.inverse_qft_approx(n, k))
        err = np.linalg.norm(Uk.data - full.data, 2)
        for _ in range(6):
            v = rng.normal(size=2 ** n) + 1j * rng.normal(size=2 ** n)
            s = Statevector(v / np.linalg.norm(v))
            assert tvd(s.evolve(Uk).probabilities(), s.evolve(full).probabilities()) <= err + 1e-12
        for phi in rng.random(6):
            s = qpe_input_state(n, float(phi))
            assert tvd(s.evolve(Uk).probabilities(), s.evolve(full).probabilities()) <= err + 1e-12


@pytest.mark.parametrize("n", range(2, 8))
def test_A09_teorema_di_esattezza_su_ogni_fase_esatta(n):
    """AQFT di grado k restituisce y con certezza se e solo se 2^(n-1-k) divide y.

    Una cp tolta (m -> j, j-m > k) agisce solo se il bit m del risultato vale 1. Le cp
    controllate dal qubit m sono tolte solo se m + k < n - 1, e la fase mancante e' una
    somma di angoli pi/2^d distinti < pi, mai multipla di 2*pi.
    """
    for k in range(1, n):
        U = Operator(A.inverse_qft_approx(n, k))
        for y in range(2 ** n):
            p = qpe_input_state(n, y / 2 ** n).evolve(U).probabilities()[y]
            exact = k >= n - 1 or y % 2 ** (n - 1 - k) == 0
            if exact:
                assert math.isclose(p, 1.0, abs_tol=1e-12), (n, k, y, p)
            else:
                assert p < 1 - 1e-9, (n, k, y, p)


@pytest.mark.parametrize("phi", [1 / 3, 1 / 6, 1 / 5, 2 / 7, (math.sqrt(5) - 1) / 2, 0.123456789])
def test_A10_fasi_non_esatte_la_resa_converge_alla_piena(phi):
    n = 8
    target = round(phi * 2 ** n) % 2 ** n
    full = qpe_input_state(n, phi).evolve(Operator(A.inverse_qft_approx(n, n - 1))).probabilities()
    gaps = []
    for k in range(1, n):
        pk = qpe_input_state(n, phi).evolve(Operator(A.inverse_qft_approx(n, k))).probabilities()
        gaps.append(abs(pk[target] - full[target]))
        assert np.isclose(pk.sum(), 1.0)
    assert gaps[-1] < 1e-12
    # Coppersmith: oltre k ~ log2(n) + 2 la perdita e' piccola.
    assert max(gaps[4:]) < 0.02
    assert full[target] >= 4 / math.pi ** 2 - 1e-9  # limite classico della QPE


# ===========================================================================
# B. Shor N=15 senza rumore
# ===========================================================================
def test_B01_grado_pieno_e_il_circuito_canonico_della_tesi():
    check = A.verifica_grado_pieno()
    assert check["identico_al_laboratorio"] is True
    assert check["canonico_tesi"] is True
    assert check["sha256"] == A.CANONICAL_SHA256


def test_B02_compilazione_deterministica_e_gradi_distinti():
    shas = []
    for k in A.K_VALUES:
        a = A._fingerprint(A._transpile(A.build_aqft_circuit(k)))
        b = A._fingerprint(A.compiled_circuit(k))
        assert a == b
        shas.append(a)
    assert len(set(shas)) == len(shas)


@pytest.mark.parametrize("k", A.K_VALUES)
def test_B03_distribuzione_ideale_identica_alla_piena(k):
    p = np.array(A.ideal_distribution(k))
    full = np.array(A.ideal_distribution(A.K_FULL))
    assert math.isclose(p.sum(), 1.0, abs_tol=1e-12)
    assert tvd(p, full) < 1e-12
    for v in range(256):
        assert math.isclose(p[v], 0.25 if v in (0, 64, 128, 192) else 0.0, abs_tol=1e-12)
    assert math.isclose(A._riassunto_ideale(k)["factor_yield"], 0.75, abs_tol=1e-12)


def test_B04_piena_coincide_con_la_legge_qpe_in_forma_chiusa():
    assert tvd(A.ideal_distribution(A.K_FULL), api._theoretical_distribution(15)) < 1e-12


@pytest.mark.parametrize("a,n_count", list(itertools.product([2, 7, 8, 11, 13], [3, 4, 5, 6, 8, 9])))
def test_B05_ogni_base_e_ogni_registro_l_aqft_non_cambia_la_distribuzione(a, n_count):
    """Ordine 2 o 4: le fasi sono esatte in due bit, quindi ogni k >= 1 e' esatto (teorema A09)."""
    full = Statevector.from_instruction(
        A.build_aqft_circuit(n_count - 1, measure=False, a=a, n_count=n_count)
    ).probabilities(list(range(n_count)))
    y_full = factor_yield(full, n_count, 15, a)
    for k in range(1, n_count - 1):
        p = Statevector.from_instruction(
            A.build_aqft_circuit(k, measure=False, a=a, n_count=n_count)
        ).probabilities(list(range(n_count)))
        assert tvd(p, full) < 1e-12, (a, n_count, k)
        assert math.isclose(factor_yield(p, n_count, 15, a), y_full, abs_tol=1e-12)


def test_B06_ramo_per_ramo_ogni_autofase_finisce_sul_suo_picco():
    """Con k >= 1 ogni ramo s da' 64 s con certezza. Senza la rotazione c6->c7 i rami
    s = 1 e s = 3 non finiscono piu' su un valore solo: c7 resta in sovrapposizione e
    l'esito e' 64 o 192 con probabilita' 1/2. Mediando sui rami la distribuzione resta
    1/4 su ogni picco, e 64 e 192 danno entrambi r = 4: fattori invariati."""
    n = 8
    for k in range(1, n):
        U = Operator(A.inverse_qft_approx(n, k))
        for s in range(4):
            p = qpe_input_state(n, s / 4).evolve(U).probabilities()
            assert math.isclose(p[64 * s], 1.0, abs_tol=1e-12)
    from qiskit import QuantumCircuit

    nessuna = QuantumCircuit(n)
    for q in range(n // 2):
        nessuna.swap(q, n - 1 - q)
    for j in range(n):
        nessuna.h(j)
    media = np.zeros(2 ** n)
    for s in range(4):
        p = qpe_input_state(n, s / 4).evolve(Operator(nessuna)).probabilities()
        media += p / 4
        if s in (0, 2):
            assert math.isclose(p[64 * s], 1.0, abs_tol=1e-12)
        else:
            assert math.isclose(p[64], 0.5, abs_tol=1e-12)
            assert math.isclose(p[192], 0.5, abs_tol=1e-12)
    assert tvd(media, qpe_distribution(n, n - 1, [s / 4 for s in range(4)])) < 1e-12
    for y in (64, 192):
        f1, f2 = extract_factors(y, n, 15, 7)
        assert {f1, f2} == {3, 5}


def test_B07_solo_la_rotazione_c6_c7_agisce():
    """Togliendo qualunque altra rotazione, ramo per ramo l'esito non cambia."""
    from qiskit import QuantumCircuit

    n = 8
    coppie = [(m, j) for j in range(n) for m in range(j)]
    for tolta in coppie:
        qc = QuantumCircuit(n)
        for q in range(n // 2):
            qc.swap(q, n - 1 - q)
        for j in range(n):
            for m in range(j):
                if (m, j) != tolta:
                    qc.cp(-math.pi / 2 ** (j - m), m, j)
            qc.h(j)
        U = Operator(qc)
        for s in range(4):
            p = qpe_input_state(n, s / 4).evolve(U).probabilities()
            certo = math.isclose(p[64 * s], 1.0, abs_tol=1e-12)
            assert certo == (tolta != (6, 7) or s in (0, 2)), (tolta, s)


@pytest.mark.parametrize("k", A.K_VALUES)
def test_B08_campionamento_aer_senza_rumore_solo_sui_picchi_e_uniforme(k):
    from qiskit_aer import AerSimulator

    shots = 4000
    mem = AerSimulator(method="matrix_product_state").run(
        A.compiled_circuit(k), shots=shots, seed_simulator=100 + k, memory=True
    ).result().get_memory()
    valori = [int(b.replace(" ", ""), 2) for b in A._normalise_memory(mem)]
    assert set(valori) <= {0, 64, 128, 192}
    conteggi = [valori.count(v) for v in (0, 64, 128, 192)]
    chi2 = sum((c - shots / 4) ** 2 / (shots / 4) for c in conteggi)
    assert chi2 < 16.27  # chi^2 con 3 gradi di liberta', p = 0,001


def test_B09_costo_compilato_coerente_con_le_rotazioni_tolte():
    s = A.aqft_structure()
    full = s["degrees"][-1]["compiled"]
    assert full == {**full, "cx": 224, "rz": 302, "sx_x": 70, "measure": 8, "depth": 412}
    prev_cx = -1
    for g in s["degrees"]:
        c = g["compiled"]
        tolte = g["rotations_removed"]
        assert g["rotations_kept"] == kept_rotations(8, g["k"])
        assert full["cx"] - c["cx"] == 2 * tolte   # ogni cp costa due CX
        assert full["rz"] - c["rz"] == 2 * tolte
        assert c["sx_x"] == full["sx_x"]          # le cp non introducono porte 1Q fisiche
        assert c["measure"] == 8
        assert c["depth"] <= full["depth"]
        assert c["cx"] > prev_cx
        prev_cx = c["cx"]


def test_B10_misure_rimappate_dal_transpiler():
    """Gli SWAP spariscono nella compilazione: la permutazione finisce nelle misure."""
    for k in A.K_VALUES:
        c = A.compiled_circuit(k)
        assert "swap" not in c.count_ops()
        mappa = {c.find_bit(i.clbits[0]).index: c.find_bit(i.qubits[0]).index
                 for i in c.data if i.operation.name == "measure"}
        assert sorted(mappa) == list(range(8))
        assert sorted(mappa.values()) == list(range(8))


def test_B11_struttura_json_completa_e_coerente():
    s = json.loads(json.dumps(A.aqft_structure()))
    assert [g["k"] for g in s["degrees"]] == list(range(1, 8))
    assert len(s["rotations"]) == 28
    assert math.isclose(s["random_factor_floor"], 63 / 256)
    for g in s["degrees"]:
        assert math.isclose(sum(g["ideal_distribution"]), 1.0, abs_tol=1e-8)
        assert g["is_full"] == (g["k"] == 7)


@pytest.mark.parametrize("bad", [0, 8, -1, 1.0, True, "1", None])
def test_B12_gradi_non_validi_rifiutati(bad):
    with pytest.raises((ValueError, TypeError)):
        A.build_aqft_circuit(bad)
    with pytest.raises((ValueError, TypeError)):
        A.rotazioni(bad)


# ===========================================================================
# C. Fuori da N=15: dove il troncamento deve costare
# ===========================================================================
def test_C01_n21_fasi_j6_il_troncamento_costa_resa_ideale():
    """r = 6: le fasi j/6 non sono esatte, quindi k piccolo perde resa (A09 non si applica)."""
    n, N, a = 8, 21, 2
    phases = [j / 6 for j in range(6)]
    full = qpe_distribution(n, n - 1, phases)
    y_full = factor_yield(full, n, N, a)
    rese = {k: factor_yield(qpe_distribution(n, k, phases), n, N, a) for k in range(1, n)}
    assert rese[1] < y_full - 0.01
    assert rese[7] == pytest.approx(y_full, abs=1e-12)
    assert abs(rese[5] - y_full) < 0.01


def test_C02_n21_registro_della_demo_coincide_con_la_legge_chiusa():
    n = 10
    full = qpe_distribution(n, n - 1, [j / 6 for j in range(6)])
    assert tvd(full, api._theoretical_distribution(21)) < 1e-12


def test_C03_n35_ordine_2_esatto_per_ogni_grado():
    n = 8
    full = qpe_distribution(n, n - 1, [0, 0.5])
    for k in range(1, n):
        assert tvd(qpe_distribution(n, k, [0, 0.5]), full) < 1e-12


@pytest.mark.parametrize("r", [3, 5, 6, 7, 10, 12])
def test_C04_ordini_generici_coerenti_con_il_limite_operatoriale(r):
    n = 8
    phases = [j / r for j in range(r)]
    full = qpe_distribution(n, n - 1, phases)
    fullU = Operator(A.inverse_qft_approx(n, n - 1)).data
    for k in range(1, n):
        err = np.linalg.norm(Operator(A.inverse_qft_approx(n, k)).data - fullU, 2)
        assert tvd(qpe_distribution(n, k, phases), full) <= err + 1e-12


# ===========================================================================
# D. Rumore
# ===========================================================================
def test_D01_senza_rumore_l_esperimento_e_rifiutato():
    with pytest.raises(ValueError):
        A.run_aqft_experiment(k=1, shots=64, seed=1, noise=ZERO)
    with pytest.raises(ValueError):
        A.run_aqft_experiment(k=1, shots=64, seed=1, noise=None)


def test_D02_braccio_pieno_identico_bit_per_bit_al_laboratorio():
    """Stesso circuito, stesso modello, stesso seed: la memoria deve coincidere.

    E' la garanzia che "QFT piena con rumore" abbia lo stesso valore nelle due schede.
    """
    seed_lab = 4242
    lab = api.run_experiment(shots=256, seed=seed_lab, noise=UC1, N=15)
    # Stesso seed nei due campi: la scheda AQFT applica alla QFT piena la stessa regola
    # (seed + NOISY_SEED_OFFSET) che il laboratorio applica al campione rumoroso.
    aq = A.run_pair_isolated(k=1, shots=256, seed=seed_lab, noise=api.normalise_noise_config(UC1))
    lab_counts = [row["count"] for row in lab["noisy"]["distribution"]]
    aq_counts = [0] * 256
    for b in aq["full"]["memory"]:
        aq_counts[int(b, 2)] += 1
    assert aq_counts == lab_counts
    assert lab["noisy"]["memory"] == aq["full"]["memory"]


def test_D03_riproducibile_con_lo_stesso_seed_diverso_con_seed_diversi():
    r1 = A.run_aqft_experiment(k=2, shots=128, seed=77, noise=UC1)
    r2 = A.run_aqft_experiment(k=2, shots=128, seed=77, noise=UC1)
    r3 = A.run_aqft_experiment(k=2, shots=128, seed=77 + 10_007, noise=UC1)
    assert r1["full"]["distribution"] == r2["full"]["distribution"]
    assert r1["aqft"]["distribution"] == r2["aqft"]["distribution"]
    assert r1["full"]["distribution"] != r3["full"]["distribution"]


@pytest.mark.parametrize("seed", [0, 2 ** 31 - 1, 2 ** 31 - A.AQFT_SEED_OFFSET, 2 ** 31 - 1_000_003])
def test_D04_seed_dei_bracci_indipendenti_e_dentro_il_dominio(seed):
    r = A.run_aqft_experiment(k=1, shots=32, seed=seed, noise=UC1)
    s = r["metadata"]["simulation_seeds"]
    from experiment_backend import NOISY_SEED_OFFSET
    assert s["full"] == (seed + NOISY_SEED_OFFSET) % 2 ** 31
    assert s["aqft"] == (s["full"] + A.AQFT_SEED_OFFSET) % 2 ** 31
    assert s["full"] != s["aqft"] and s["full"] != seed
    assert 0 <= s["full"] < 2 ** 31 and 0 <= s["aqft"] < 2 ** 31


CANALI = {
    "solo_eps1q": {**ZERO, "eps_1q": 0.01},
    "solo_eps2q": {**ZERO, "eps_2q": 0.03},
    "solo_termico": {**ZERO, "t1_us": 30.0, "t2_us": 20.0},
    "solo_readout": {**ZERO, "readout_0to1": 0.05, "readout_1to0": 0.08},
    "solo_coerente": {**ZERO, "coherent_overrotation_deg": 6.0},
    "uc1": UC1,
    "uc2": UC2,
}


@pytest.mark.parametrize("nome", list(CANALI))
@pytest.mark.parametrize("k", [1, 3, 6])
def test_D05_ogni_canale_e_ogni_grado_risultato_valido(nome, k):
    shots = 256
    r = A.run_aqft_experiment(k=k, shots=shots, seed=9 + k, noise=CANALI[nome])
    assert r["config"]["k"] == k
    for arm in ("full", "aqft"):
        a = r[arm]
        assert len(a["distribution"]) == 256
        assert sum(a["distribution"]) == shots
        assert a["n_ok"] == round(a["factor_yield"] * shots)
        lo, hi = wilson(a["n_ok"], shots)
        assert a["wilson_ci"]["low"] == pytest.approx(lo) and a["wilson_ci"]["high"] == pytest.approx(hi)
        assert lo <= a["factor_yield"] <= hi
        assert 0 <= a["peak_mass"] <= 1
    assert r["full"]["compiled"]["cx"] == 224
    assert r["aqft"]["compiled"]["cx"] == 224 - 2 * (28 - kept_rotations(8, k))
    c = r["comparison"]
    assert c["difference"] == pytest.approx(r["aqft"]["factor_yield"] - r["full"]["factor_yield"])
    assert c["low"] <= c["difference"] <= c["high"]
    assert -1 <= c["low"] and c["high"] <= 1


def test_D06_newcombe_coincide_con_l_implementazione_della_tesi():
    """La formula della demo e quella di qft_approssimata.py devono dare lo stesso IC."""
    import estrai_dati_aqft as E

    rng = random.Random(5)
    for _ in range(200):
        n1, n2 = rng.randint(30, 3000), rng.randint(30, 3000)
        s1, s2 = rng.randint(0, n1), rng.randint(0, n2)
        y1, y2 = s1 / n1, s2 / n2
        l1, h1 = wilson(s1, n1)
        l2, h2 = wilson(s2, n2)
        demo = A._newcombe(y1, {"low": l1, "high": h1}, y2, {"low": l2, "high": h2})
        diff, lo, hi = E.newcombe_diff_ci(s1, n1, s2, n2)
        assert demo["difference"] == pytest.approx(diff, abs=1e-12)
        assert demo["low"] == pytest.approx(lo, abs=1e-9)
        assert demo["high"] == pytest.approx(hi, abs=1e-9)


def test_D07_rumore_totale_porta_entrambi_i_bracci_sul_pavimento():
    """Depolarizzazione completa su ogni porta fisica: esiti uniformi, resa = 63/256.

    Si controlla ogni braccio contro il pavimento a 4,5 sigma e l'uniformita' con un chi^2.
    Non si chiede che l'IC della differenza contenga lo zero: al 95% fallirebbe una volta
    su venti per costruzione. La legge esatta e' verificata in D13.
    """
    noise = {**ZERO, "eps_1q": 1.0, "eps_2q": 1.0}
    shots = 2048
    r = A.run_aqft_experiment(k=1, shots=shots, seed=3, noise=noise)
    floor = 63 / 256
    sigma = math.sqrt(floor * (1 - floor) / shots)
    for arm in ("full", "aqft"):
        assert abs(r[arm]["factor_yield"] - floor) < 4.5 * sigma, (arm, r[arm]["factor_yield"])
        # 16 classi da 16 valori: chi^2 con 15 gradi di liberta', soglia p = 0,001
        classi = np.array(r[arm]["distribution"]).reshape(16, 16).sum(axis=1)
        chi2 = float(((classi - shots / 16) ** 2 / (shots / 16)).sum())
        assert chi2 < 37.70, (arm, chi2)


def test_D07b_aer_usa_seed_piu_indice_dello_shot_e_l_offset_basta():
    """Proprieta' di Aer da cui dipende l'indipendenza dei bracci: lo shot i usa seed + i.

    Se una versione futura cambiasse comportamento, questo test lo segnala. L'offset fra i
    bracci deve superare il numero massimo di shot, altrimenti i flussi si sovrappongono.
    """
    from qiskit_aer import AerSimulator

    sim = AerSimulator(method="matrix_product_state",
                       noise_model=build_illustrative_noise_model(api.normalise_noise_config(UC1)))
    c = A.compiled_circuit(7)
    m0 = sim.run(c, shots=64, seed_simulator=500, memory=True).result().get_memory()
    m1 = sim.run(c, shots=64, seed_simulator=501, memory=True).result().get_memory()
    assert m1[:-1] == m0[1:]
    assert A.AQFT_SEED_OFFSET > A.AQFT_MAX_SHOTS
    import precalcola_aqft as P
    assert P.SEED_STEP > 4096


@pytest.mark.parametrize("p01,p10", [(0.02, 0.02), (0.1, 0.03), (0.25, 0.25)])
def test_D08_solo_readout_coincide_con_la_formula_analitica(p01, p10):
    """Il readout agisce dopo il circuito: entrambi i bracci devono dare la distribuzione
    ideale (identica per ogni k) passata attraverso la matrice di confusione."""
    attesa = apply_readout(np.array(A.ideal_distribution(7)), 8, p01, p10)
    y_att = factor_yield(attesa, 8, 15, 7)
    shots = 2048
    r = A.run_aqft_experiment(k=1, shots=shots, seed=11, noise={**ZERO, "readout_0to1": p01, "readout_1to0": p10})
    sigma = math.sqrt(y_att * (1 - y_att) / shots)
    for arm in ("full", "aqft"):
        assert abs(r[arm]["factor_yield"] - y_att) < 4.5 * sigma, (arm, r[arm]["factor_yield"], y_att)
        osservata = np.array(r[arm]["distribution"]) / shots
        assert tvd(osservata, attesa) < 0.12


@pytest.mark.parametrize("k", [1, 4, 7])
def test_D09_errore_coerente_dopo_sx_x_nessuna_porta_sfugge(k):
    """La sovrarotazione agisce dopo sx/x: con l'angolo a zero il modello e' vuoto."""
    model = build_illustrative_noise_model({**ZERO, "coherent_overrotation_deg": 0.0})
    assert model.noise_instructions == [] or set(model.noise_instructions) <= {"measure"}
    ops = set(A.compiled_circuit(k).count_ops())
    assert ops <= {"rz", "sx", "x", "cx", "measure", "barrier"}


@pytest.mark.slow
@pytest.mark.parametrize("nome,noise", [("uc1", UC1), ("uc2", UC2)])
def test_D10_densita_esatta_vantaggio_reale_e_campionamento_coerente(nome, noise):
    """Matrice densita' completa: il vantaggio k=1 su k=7 esiste nella legge, non solo nel campione,
    e il campionamento MPS della demo ne e' una stima compatibile."""
    esatte = {}
    for k in (1, 7):
        esatte[k] = factor_yield(exact_noisy_distribution(k, noise), 8, 15, 7)
    assert esatte[1] > esatte[7] + 0.03, esatte

    shots = 2048
    r = A.run_aqft_experiment(k=1, shots=shots, seed=21, noise=noise)
    for arm, k in (("full", 7), ("aqft", 1)):
        sigma = math.sqrt(esatte[k] * (1 - esatte[k]) / shots)
        assert abs(r[arm]["factor_yield"] - esatte[k]) < 4.5 * sigma, (arm, r[arm]["factor_yield"], esatte[k])

    curva = A.aqft_curva()
    if curva:
        for p in curva["presets"][nome]["points"]:
            if p["k"] in esatte:
                sigma = math.sqrt(esatte[p["k"]] * (1 - esatte[p["k"]]) / p["shots"])
                assert abs(p["factor_yield"] - esatte[p["k"]]) < 4.5 * sigma, (nome, p)


@pytest.mark.slow
def test_D13_densita_esatta_depolarizzazione_totale_uniforme():
    """Nessuna porta sfugge al rumore: con depolarizzazione completa la legge e' uniforme."""
    noise = {**ZERO, "eps_1q": 1.0, "eps_2q": 1.0}
    for k in (1, 7):
        p = exact_noisy_distribution(k, noise)
        assert np.allclose(p, 1 / 256, atol=1e-10), k


@pytest.mark.slow
def test_D11_densita_esatta_solo_readout_aqft_e_piena_identiche():
    """Senza rumore sulle porte la legge degli esiti non dipende da k."""
    noise = {**ZERO, "readout_0to1": 0.04, "readout_1to0": 0.06}
    p1 = exact_noisy_distribution(1, noise)
    p7 = exact_noisy_distribution(7, noise)
    assert tvd(p1, p7) < 1e-10
    assert tvd(p7, apply_readout(np.array(A.ideal_distribution(7)), 8, 0.04, 0.06)) < 1e-10


def test_D12_curva_precalcolata_coerente():
    curva = A.aqft_curva()
    if not curva:
        pytest.skip("precomputed/aqft_curva.json assente")
    assert curva["full_circuit_sha256"] == A.CANONICAL_SHA256
    assert set(curva["presets"]) == {"readout", "uc1", "uc2"}
    for nome, p in curva["presets"].items():
        assert [q["k"] for q in p["points"]] == list(range(1, 8))
        for i, q in enumerate(p["points"]):
            i = ["readout", "uc1", "uc2"].index(nome)
            assert q["seed"] == curva["seed_base"] + curva["seed_step"] * (7 * i + q["k"] - 1)
            assert curva["seed_step"] > q["shots"]  # flussi di seed disgiunti fra punti
            assert q["successes"] == round(q["factor_yield"] * q["shots"])
            lo, hi = wilson(q["successes"], q["shots"])
            assert q["wilson_ci"]["low"] == pytest.approx(lo, abs=1e-6)
            assert q["wilson_ci"]["high"] == pytest.approx(hi, abs=1e-6)
        assert p["best_k"] == max(p["points"], key=lambda q: q["factor_yield"])["k"]
    # Piu' rumore sulle porte, piu' guadagno. Con il solo readout la legge non dipende da k
    # (D11): la differenza fra k=1 e k=7 deve stare dentro la fluttuazione statistica.
    gain = {n: p["points"][0]["factor_yield"] - p["points"][-1]["factor_yield"] for n, p in curva["presets"].items()}
    assert gain["uc2"] > gain["uc1"] > 0.05
    ro = curva["presets"]["readout"]
    assert ro["noise"]["t1_us"] is None and ro["noise"]["eps_2q"] == 0
    pbar = sum(q["factor_yield"] for q in ro["points"]) / 7
    sigma = math.sqrt(2 * pbar * (1 - pbar) / ro["points"][0]["shots"])
    assert abs(gain["readout"]) < 4.5 * sigma
    for q in ro["points"]:
        assert abs(q["factor_yield"] - pbar) < 4.5 * math.sqrt(pbar * (1 - pbar) / q["shots"])


# ===========================================================================
# E. API
# ===========================================================================
def test_E01_struttura_via_api():
    r = client.get("/api/aqft/structure")
    assert r.status_code == 200
    d = r.json()
    assert d["full_circuit_check"]["canonico_tesi"] is True
    assert r.headers["cache-control"] == "no-store"


def test_E02_esperimento_via_api():
    r = client.post("/api/aqft/experiment", json={"k": 1, "shots": 64, "seed": 5, "noise": UC1})
    assert r.status_code == 200
    d = r.json()
    assert d["config"]["k"] == 1 and d["config"]["shots"] == 64
    assert "memory" not in d["full"] and "iterations" not in d["full"]


@pytest.mark.parametrize("payload", [
    {"k": 0}, {"k": 8}, {"k": 1.5}, {"k": "1"}, {"k": True},
    {"k": 1, "shots": 31}, {"k": 1, "shots": 2049}, {"k": 1, "shots": 100.0},
    {"k": 1, "seed": -1}, {"k": 1, "seed": 2 ** 31},
    {"k": 1, "a": 2}, {"k": 1, "N": 21}, {"k": 1, "n_count": 6},
    {"k": 1, "noise": {"eps_1q": 2.0}}, {"k": 1, "noise": {"eps_2q": -0.1}},
    {"k": 1, "noise": {"t1_us": 10.0, "t2_us": 30.0}}, {"k": 1, "noise": {"t1_us": 10.0}},
    {"k": 1, "noise": {"sconosciuto": 1}}, {"k": 1, "noise": {"eps_1q": "0.1"}},
])
def test_E03_input_non_validi_rifiutati(payload):
    r = client.post("/api/aqft/experiment", json={"noise": UC1, **payload} if "noise" not in payload else payload)
    assert r.status_code == 422, r.text


def test_E04_rumore_nullo_400():
    r = client.post("/api/aqft/experiment", json={"k": 1, "shots": 64, "noise": {}})
    assert r.status_code == 400


def test_E05_slot_occupato_429():
    assert _SIMULATION_SLOT.acquire(blocking=False)
    try:
        r = client.post("/api/aqft/experiment", json={"k": 1, "shots": 64, "noise": UC1})
        assert r.status_code == 429
        assert r.headers.get("retry-after") == "5"
    finally:
        _SIMULATION_SLOT.release()


def test_E06_worker_guasto_503_senza_dettagli(monkeypatch):
    def guasto(**_):
        raise A.SimulationUnavailable("Simulazione temporaneamente non disponibile.")
    monkeypatch.setattr(A, "run_pair_isolated", guasto)
    r = client.post("/api/aqft/experiment", json={"k": 1, "shots": 64, "noise": UC1})
    assert r.status_code == 503
    assert "Traceback" not in r.text


def test_E07_worker_che_restituisce_spazzatura(monkeypatch):
    import subprocess

    class Finto:
        returncode = 0
        stdout = "non json"
        stderr = ""
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Finto())
    with pytest.raises(A.SimulationUnavailable):
        A.run_pair_isolated(k=1, shots=32, seed=1, noise=UC1)
    Finto.stdout = json.dumps({"ok": False})
    with pytest.raises(A.SimulationUnavailable):
        A.run_pair_isolated(k=1, shots=32, seed=1, noise=UC1)
    Finto.returncode = 1
    with pytest.raises(A.SimulationUnavailable):
        A.run_pair_isolated(k=1, shots=32, seed=1, noise=UC1)


def test_E08_file_precalcolati_assenti_risposta_vuota(monkeypatch, tmp_path):
    monkeypatch.setattr(A, "_HERE", str(tmp_path))
    A.aqft_curva.cache_clear()
    A.aqft_tesi.cache_clear()
    try:
        assert client.get("/api/aqft/curva").json() == {}
        assert client.get("/api/aqft/tesi").json() == {}
    finally:
        A.aqft_curva.cache_clear()
        A.aqft_tesi.cache_clear()


def test_E09_endpoint_esistenti_non_toccati():
    assert client.get("/api/circuit-cost", params={"N": 15}).json()["counts"]["cx"] == 224
    assert client.get("/health").json() == {"ok": True}


# ===========================================================================
# F. Dati della tesi
# ===========================================================================
@pytest.fixture(scope="module")
def tesi():
    d = A.aqft_tesi()
    if not d:
        pytest.skip("precomputed/aqft_tesi.json assente")
    return d


def test_F01_n15_coincide_con_i_valori_citati_nel_capitolo_5(tesi):
    n15 = tesi["n15"]
    assert n15["selected_k"] == 1
    assert n15["selected_holdout"] == pytest.approx(0.6279, abs=5e-5)
    assert n15["full_holdout"] == pytest.approx(0.4792, abs=5e-5)
    assert n15["contrast"]["difference"] == pytest.approx(0.1487, abs=5e-5)
    assert n15["contrast"]["low"] == pytest.approx(0.1273, abs=5e-5)
    assert n15["contrast"]["high"] == pytest.approx(0.1699, abs=5e-5)
    assert n15["ecr"] == {"reference": 362, "selected": 279, "delta": 83}
    assert n15["canonical_circuit_sha256"] == A.CANONICAL_SHA256
    assert n15["schema_version"] == "2.0"
    assert [g["k"] for g in n15["grid"]] == list(range(1, 8))
    assert n15["degenerate_caveat"] is True


def test_F02_n15_contrasto_ricalcolato_dai_conteggi(tesi):
    import estrai_dati_aqft as E

    g = {x["k"]: x for x in tesi["n15"]["grid"]}
    diff, lo, hi = E.newcombe_diff_ci(g[1]["holdout_successes"], g[1]["holdout_shots"],
                                       g[7]["holdout_successes"], g[7]["holdout_shots"])
    assert diff == pytest.approx(tesi["n15"]["contrast"]["difference"], abs=1e-6)
    assert lo == pytest.approx(tesi["n15"]["contrast"]["low"], abs=1e-6)
    assert hi == pytest.approx(tesi["n15"]["contrast"]["high"], abs=1e-6)


def test_F03_n21_e_qpe_coincidono_con_il_capitolo_5(tesi):
    n21 = tesi["n21"]
    assert n21["ecr"]["full"] == 49661 and n21["ecr"]["truncated"] == 23178
    riga = next(r for r in n21["rows"] if r["noise_factor"] == 0.003)
    assert riga["contrast"]["difference"] == pytest.approx(-0.109, abs=5e-4)
    assert riga["contrast"]["low"] == pytest.approx(-0.221, abs=1e-3)
    assert riga["contrast"]["high"] == pytest.approx(0.006, abs=1e-3)
    qpe = tesi["qpe"]
    assert len(qpe["contrasts"]) == 9
    assert qpe["positive"] == 9 and qpe["excluding_zero"] == 6
    best = max(qpe["contrasts"], key=lambda c: c["difference"])
    assert best["n"] == 10 and best["difference"] == pytest.approx(0.1255, abs=5e-5)


def test_F04_artefatti_originali_se_disponibili(tesi):
    """Se il repository della tesi e' accanto alla demo, si rilegge e si confronta l'hash."""
    import hashlib

    radice = os.path.abspath(os.path.join(HERE, "..", ".."))
    fonti = [tesi["n15"]["fonte"], tesi["qpe"]["fonte"], *tesi["n21"]["fonti"]]
    trovati = 0
    for f in fonti:
        p = os.path.join(radice, f["file"])
        if os.path.exists(p):
            with open(p, "rb") as fh:
                assert hashlib.sha256(fh.read()).hexdigest() == f["sha256"], f["file"]
            trovati += 1
    if not trovati:
        pytest.skip("artefatti M15 non presenti accanto alla demo")


# ===========================================================================
# G. Stadio per stadio: sfere di Bloch del circuito AQFT
# ===========================================================================
def _lunghezze(dati, indice):
    return [q["len"] for q in dati["stages"][indice]["qubits"]]


def test_G01_senza_rumore_aqft_e_piena_coincidono_a_ogni_stadio():
    piena = A.aqft_bloch(7, {})
    tronca = A.aqft_bloch(1, {})
    assert [s["kind"] for s in piena["stages"]] == [s["kind"] for s in tronca["stages"]]
    for s_p, s_t in zip(piena["stages"], tronca["stages"]):
        for q_p, q_t in zip(s_p["qubits"], s_t["qubits"]):
            for c in ("x", "y", "z"):
                assert q_p[c] == pytest.approx(q_t[c], abs=1e-9), (s_p["kind"], q_p["i"], c)


def test_G02_con_il_rumore_dopo_la_qft_le_frecce_dell_aqft_sono_piu_lunghe():
    ideale = A.aqft_bloch(7, {})
    qft = next(i for i, s in enumerate(ideale["stages"]) if s["kind"] == "qft")
    puri = [q["i"] for q in ideale["stages"][qft]["qubits"] if q["len"] > 0.99]
    assert len(puri) == 6
    for rumore in (UC1, UC2):
        piena = _lunghezze(A.aqft_bloch(7, rumore), qft)
        tronca = _lunghezze(A.aqft_bloch(1, rumore), qft)
        for i in puri:
            assert tronca[i] > piena[i], (rumore, i, tronca[i], piena[i])
        # prima della QFT i due circuiti sono identici anche sotto rumore
        for j in range(qft):
            assert _lunghezze(A.aqft_bloch(7, rumore), j) == pytest.approx(_lunghezze(A.aqft_bloch(1, rumore), j), abs=1e-9)


def test_G03_il_readout_non_cambia_le_sfere():
    assert A.aqft_bloch(1, {**ZERO, "readout_0to1": 0.05, "readout_1to0": 0.05})["stages"] == A.aqft_bloch(1, {})["stages"]


def test_G04_precalcolo_coerente_con_la_piena_del_laboratorio():
    """k=7 deve dare le stesse sfere del laboratorio del rumore (stesso circuito canonico)."""
    lab = api.noisy_bloch(15, UC1)
    piena = A.aqft_bloch(7, UC1)
    assert len(lab["stages"]) == len(piena["stages"])
    for s_l, s_p in zip(lab["stages"], piena["stages"]):
        assert [q["len"] for q in s_l["qubits"]] == pytest.approx([q["len"] for q in s_p["qubits"]], abs=1e-6)


def test_G05_api_bloch_valida_gli_input():
    assert client.post("/api/aqft/bloch", json={"k": 1, "noise": {}}).status_code == 200
    for bad in ({"k": 0}, {"k": 8}, {"k": "1"}, {"k": 1, "N": 21}, {"k": 1, "noise": {"eps_2q": 2}}):
        assert client.post("/api/aqft/bloch", json=bad).status_code == 422, bad


@pytest.mark.slow
def test_G06_precalcolo_identico_alla_simulazione_dal_vivo():
    from experiment_backend import run_bloch_isolated

    vivo = run_bloch_isolated(N=15, noise=A._rumore_sulle_porte(UC1), k=1)
    precalcolato = A.aqft_bloch(1, UC1)
    assert precalcolato["source"] == "precomputed"
    for s_v, s_p in zip(vivo["stages"], precalcolato["stages"]):
        assert [q["len"] for q in s_v["qubits"]] == pytest.approx([q["len"] for q in s_p["qubits"]], abs=1e-9)
