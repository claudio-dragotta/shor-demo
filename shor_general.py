"""Costruzione condivisa dei circuiti Shor e percorso locale per N libero.

Le configurazioni N in {15,21,35} sono i preset validati esposti dall'API v3, con limiti
piu' stretti per N=21/35. I moltiplicatori
Beauregard usati da N=21/35 hanno truth table, ancilla e QPE end-to-end validate. Il ramo
generico usa la stessa costruzione ma, per N diversi, non è coperto da quella validazione.

Per qualsiasi altro N uso `beauregard_c_amod` (Beauregard 2002, `beauregard.py`), la stessa
decomposizione aritmetica dei preset N=21/35, generica in N. Il costo resta però elevato: nel
contratto riproducibile Qiskit 2.5.0, `N=21, a=2, n_count=8`, compilato nella base
RZ/SX/X/CX, contiene 21.036 CX e ha profondità 23.081. Quel conteggio vale per `n_count=8`,
la diagnostica della tesi; la demo usa `n_count=10` per N=21, quindi un circuito più grande.
Il valore `(1-15*lambda_2q/16)^21036 = 2,698687974e-09` per
`lambda_2q=0,001` è soltanto un proxy indipendente di "nessun evento 2Q", non una probabilità
di successo, una fedeltà del circuito o una previsione del rendimento di Shor.

Isolamento in sottoprocesso per le chiamate ad Aer: stesso identico pattern di
quantum_backend.py (Aer con method='matrix_product_state' va in segfault nel thread interno di
Streamlit — vedi il README della demo). L'estrazione dei layer (per il disegno step-by-step)
invece usa solo Qiskit-core (circuit_to_dag), leggero e sicuro anche in-process.
"""
import json
import math
import os
import random
import subprocess
import sys
from math import ceil, gcd, log2

# In questo repo-demo standalone shor_core.py e beauregard.py sono vendored nella stessa
# cartella (nel monorepo della tesi vivono in Extra/experiments/campagne_classiche_M1-M4/).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shor_core import inverse_qft, shor_circuit, extract_factors, build_noise_model  # noqa: E402
from beauregard import beauregard_c_amod  # noqa: E402

LEGACY_PRESET_N = {15, 21, 35}
LEGACY_PRESET_A = {15: 7, 21: 2, 35: 6}
LEGACY_PRESET_N_COUNT = {15: 8, 21: 10, 35: 12}

# Tetto di sicurezza per N fuori dai preset legacy — misurato, non stimato a occhio: la QFT⁻¹ sul
# registro count (n_count qubit) è il vero collo di bottiglia per un simulatore MPS su un
# circuito così entangled (non a caso: è la stessa ragione per cui Shor è interessante su un
# computer quantistico reale — se fosse facile simularlo classicamente per N grandi, non
# offrirebbe alcun vantaggio). Benchmark reali su questa macchina:
#   N=33  (n_count=12, 1 passaggio non banale): 64 shot ideali in ~11s   -> USABILE
#   N=91  (n_count=15, 2 passaggi non banali):  4 shot ideali >100s      -> IMPRATICABILE
# Tengo il tetto sul lato sicuro di n_count=12 (l'unico punto confermato veloce).
N_CAP = 48  # n_count_for(48) resta a 12; n_count_for(49) sale già a 13 (vedi sopra)


def n_count_for(N):
    if N in LEGACY_PRESET_N_COUNT:
        return LEGACY_PRESET_N_COUNT[N]
    return ceil(2 * log2(N)) + 1  # stesso margine già usato per N=21/35 (2^n_count >= N^2, +1 di scorta)


def _is_prime(n):
    if n < 2:
        return False
    for d in range(2, int(n ** 0.5) + 1):
        if n % d == 0:
            return False
    return True


def _perfect_power(N):
    for k in range(2, int(log2(N)) + 2):
        b = round(N ** (1.0 / k))
        for bb in (b - 1, b, b + 1):
            if bb > 1 and bb ** k == N:
                return bb, k
    return None


def _multiplicative_order(a, N, max_r):
    """Ordine moltiplicativo di a mod N (il più piccolo r>0 con a^r=1 mod N), calcolo classico
    puro (nessun quantum). None se supera max_r (candidato scartato, troppo profondo per una
    demo dal vivo)."""
    x = a % N
    r = 1
    while x != 1:
        x = (x * a) % N
        r += 1
        if r > max_r:
            return None
    return r


def _find_good_base(N, n_count, seed, tries=40, max_r=None):
    """Cerca una base `a` coprima con N e con periodo r il più corto possibile — STESSA idea già
    usata per gli esempi di tesi (N=15 ha r=4, N=35 ha r=2: entrambi scelti apposta per un
    circuito poco profondo, non per proprietà speciali di N). Qui lo faccio in automatico
    provando `tries` basi a caso e tenendo la migliore, invece di curarle a mano.

    Un circuito con periodo r ha bisogno di un solo passaggio "non banale" (U(a^{2^j})) per ogni
    j con r non divisore di 2^j: se r è una potenza di 2 il circuito è cortissimo (come N=15);
    altrimenti servono più passaggi (come N=21 in tesi, r=6, tutti gli 8 passaggi non banali) —
    ma con N più piccoli o basi fortunate spesso un r piccolo tiene comunque il conteggio di
    passaggi non banali basso.

    Ritorna (a, r, n_passaggi_non_banali) del miglior candidato trovato, o None se nessuno dei
    `tries` tentativi ha dato una base valida (gcd(a,N)>1 viene gestito PRIMA da
    classical_preprocess, qui arrivano solo basi già coprime)."""
    max_r = max_r or N
    rng = random.Random(seed)
    best = None
    for _ in range(tries):
        a = rng.randint(2, N - 2)
        if gcd(a, N) != 1:
            continue
        r = _multiplicative_order(a, N, max_r)
        if r is None or r % 2 != 0:
            continue
        half = pow(a, r // 2, N)
        if half == N - 1:
            continue  # radice banale di 1 (a = -1 mod N o equivalente): non da' mai un fattore
        nontrivial = sum(1 for j in range(n_count) if pow(a, 2 ** j, N) != 1)
        if best is None or nontrivial < best[2]:
            best = (a, r, nontrivial)
        if nontrivial <= 2:
            break  # abbastanza corto, non serve continuare a cercare
    return best


def classical_preprocess(N, seed=None):
    """Pre-processing classico standard di Shor. Ritorna un dict:
    - done=True: fattori già trovati SENZA quantum computer (N pari / potenza perfetta / N primo
      / colpo di fortuna con gcd(a,N)>1) — p/q valorizzati, a=None (nessun circuito da mostrare).
    - done=False: nessuna scorciatoia classica, `a` è la base pronta per il circuito — fissa e
      uguale a quella di tesi per N in {15,21,35}, altrimenti quella con periodo più corto
      trovata da `_find_good_base` (necessario per restare veloci in una demo dal vivo: con una
      base scelta puramente a caso anche un N piccolo come 33 può risultare troppo lento — vedi
      commento in cima al file)."""
    if not isinstance(N, int) or N < 4:
        raise ValueError("N deve essere un intero >= 4.")
    if N >= N_CAP and N not in LEGACY_PRESET_N:
        raise ValueError(
            f"N={N} supera il tetto di sicurezza della demo live (N<{N_CAP}). Prova un N più "
            "piccolo, oppure uno dei tre preset legacy (15, 21, 35)."
        )
    if N % 2 == 0:
        return dict(done=True, reason="N è pari", p=2, q=N // 2, a=None, r=None)
    pp = _perfect_power(N)
    if pp is not None:
        b, k = pp
        return dict(done=True, reason=f"N è una potenza perfetta ({b}^{k})", p=b, q=N // b, a=None, r=None)
    if _is_prime(N):
        return dict(done=True, reason="N è primo: non è fattorizzabile", p=None, q=None, a=None, r=None)

    if N in LEGACY_PRESET_A:
        a = LEGACY_PRESET_A[N]
        return dict(
            done=False, reason=None, p=None, q=None, a=a,
            validated=True, arithmetic_validated=True,
            web_supported=True, legacy_preset=True,
        )

    # Un solo tentativo (non una manciata): è esattamente la formulazione da manuale di Shor
    # ("scegli una a a caso; se gcd(a,N)>1 hai avuto fortuna, altrimenti procedi al circuito").
    # Con N piccoli come quelli di una demo, anche solo 3-4 tentativi renderebbero la fortuna
    # classica quasi certa quasi sempre, saltando quasi sempre il circuito quantistico — che è
    # il punto centrale della demo.
    rng = random.Random(seed)
    a = rng.randint(2, N - 1)
    g = gcd(a, N)
    if g > 1:
        return dict(done=True, reason=f"gcd({a}, {N}) = {g} — fattore trovato per fortuna classica",
                    p=g, q=N // g, a=a, r=None)

    n_count = n_count_for(N)
    found = _find_good_base(N, n_count, seed)
    if found is None:
        raise ValueError(
            f"Non trovo una base con periodo abbastanza corto per N={N} in un numero "
            "ragionevole di tentativi — prova un altro N."
        )
    a, r, nontrivial = found
    return dict(
        done=False, reason=None, p=None, q=None, a=a,
        validated=False, arithmetic_validated=False, web_supported=False,
        r=r, nontrivial_layers=nontrivial,
    )


def speed_warning(N, shots, noise_cfg=None, extra_noise=None):
    """Stima onesta in secondi, basata sul benchmark reale in _per_shot_budget (non una formula
    inventata): fuori dall'istanza compatta N=15, e specialmente con rumore attivo, il tempo può
    salire a diversi minuti — meglio dirlo PRIMA che l'utente prema Esegui, non dopo un timeout."""
    if N == 15:
        return None
    if N in LEGACY_PRESET_N:
        return (
            f"N={N} usa aritmetica Beauregard validata ed è disponibile nella demo web "
            "con un limite di 128 shot per contenere il costo della simulazione classica."
        )
    est = 25 + shots * _per_shot_budget(N, noise_cfg, extra_noise)
    if est > 90:
        minutes = est / 60
        return (f"N={N} con {shots} iterazioni: stima ottimistica ~{minutes:.0f} minuti "
                f"{'(rumore attivo, molto più lento del caso ideale) ' if (noise_cfg or extra_noise) else ''}"
                "— troppo per una demo dal vivo. Riduci le iterazioni o usa un N più piccolo.")
    return (f"N={N} non è coperto dalla validazione aritmetica dei preset: "
            f"stima ~{est:.0f}s per {shots} iterazioni "
            "(tempo non garantito, può variare).")


def build_circuit(N, a, n_count):
    """Circuito QPE locale. N in {15,21,35}: richiama shor_core.shor_circuit; N=21/35 hanno
    aritmetica validata e limiti web più stretti. Per gli altri N usa lo
    stesso schema del ramo Beauregard di shor_circuit — H sul
    registro count, |1> sul registro x, U(a^2^j) controllate via beauregard_c_amod, QFT^-1,
    misura — solo senza il vincolo N∈{21,35} che vive nel dispatch di shor_circuit, non nella
    matematica del metodo (beauregard_c_amod è generico in N)."""
    if N in LEGACY_PRESET_N:
        return shor_circuit(N, a, n_count)

    from qiskit import QuantumCircuit
    n = ceil(log2(N + 1))
    n_b = n + 1
    n_total = n_count + n + n_b + 1  # count + x + b + ancilla
    qc = QuantumCircuit(n_total, n_count)
    for q in range(n_count):
        qc.h(q)
    qc.x(n_count + n - 1)  # |x=1>: MSB del registro x (stessa convenzione di shor_circuit/Beauregard)
    x_qubits = list(range(n_count, n_count + n))
    b_qubits = list(range(n_count + n, n_count + n + n_b))
    anc_qubit = [n_count + n + n_b]
    for j in range(n_count):
        power = 2 ** j
        if pow(a, power, N) != 1:
            gate = beauregard_c_amod(a, N, power)
            qc.append(gate, [j] + x_qubits + b_qubits + anc_qubit)
    qc.barrier()
    qc.append(inverse_qft(n_count), range(n_count))
    qc.measure(range(n_count), range(n_count))
    return qc


def circuit_layers(N, a, n_count):
    """Struttura a livelli del circuito BASE (non trasposto) per il disegno step-by-step —
    stesso approccio di quantum_backend.base_circuit_layers, generalizzato a N/a qualsiasi.
    Solo Qiskit-core (circuit_to_dag): nessun Aer, sicuro anche dentro il thread di Streamlit."""
    from qiskit.converters import circuit_to_dag
    qc = build_circuit(N, a, n_count)
    dag = circuit_to_dag(qc)
    layers = []
    for layer in dag.layers():
        ops = []
        for node in layer["graph"].op_nodes():
            qubits = [qc.find_bit(q).index for q in node.qargs]
            name = node.op.name
            if name.startswith("QFT"):
                name = "QFT⁻¹"
            ops.append({"name": name, "qubits": qubits})
        layers.append(ops)
    return layers, qc.num_qubits


TARGETABLE_GATES = ["h", "x", "u", "u1", "u2", "u3", "rz", "sx", "cx", "cp", "swap", "cswap"]


def build_targeted_noise_model(noise_cfg, extra_noise):
    """noise_cfg: dict globale (build_noise_model) o None. extra_noise: lista di
    {'qubits': [idx,...], 'kind': 'depolarizing'|'decoherence'|'readout', 'value': ...} — stesso
    principio del "rumore mirato" già presente nella vecchia vista (quantum_backend.inject_gate_noise),
    ma qui applicato per qubit tramite un Qiskit NoiseModel invece che per singola istanza di
    gate: più semplice da esporre in UI per un circuito che cambia forma a seconda di N.
    kind='depolarizing': value = probabilità extra (depolarizing_error, gate a 1 qubit).
    kind='decoherence': value = [t1_ns, t2_ns] (thermal_relaxation_error, gate a 1 qubit).
    kind='readout': value = probabilità di bit-flip in lettura (ReadoutError), solo su count.
    """
    from qiskit_aer.noise import NoiseModel, ReadoutError, depolarizing_error, thermal_relaxation_error
    nm = build_noise_model(**noise_cfg) if noise_cfg else NoiseModel()

    # Qiskit SOVRASCRIVE (non compone) un errore globale quando gliene si specifica uno per un
    # singolo qubit — per non perdere il rumore di base già impostato sui qubit presi di mira,
    # ricostruisco a mano la stessa composizione di shor_core.build_noise_model e ci compongo
    # sopra l'errore extra, invece di sostituirla.
    if noise_cfg:
        base_hx = depolarizing_error(noise_cfg["eps_1q"], 1).compose(
            thermal_relaxation_error(noise_cfg["t1_ns"], noise_cfg["t2_ns"], 50))
        base_rz = depolarizing_error(noise_cfg["eps_1q"], 1)
    else:
        base_hx = base_rz = None

    for spec in extra_noise or []:
        qubits = [q for q in spec.get("qubits", []) if q is not None]
        if not qubits:
            continue
        kind, value = spec["kind"], spec["value"]
        if kind == "readout":
            for q in qubits:
                nm.add_readout_error(ReadoutError([[1 - value, value], [value, 1 - value]]), [q])
            continue
        if kind == "depolarizing":
            extra_err = depolarizing_error(min(max(value, 0.0), 1.0 - 1e-9), 1)
        elif kind == "decoherence":
            t1_ns, t2_ns = value
            extra_err = thermal_relaxation_error(t1_ns, min(t2_ns, 2 * t1_ns), 50)
        else:
            continue
        hx_err = base_hx.compose(extra_err) if base_hx else extra_err
        rz_err = base_rz.compose(extra_err) if base_rz else extra_err
        for q in qubits:  # add_quantum_error vuole un qubit (o tupla) per chiamata, non una lista
            nm.add_quantum_error(hx_err, ["h", "x", "u", "u2", "u3", "sx"], [q])
            nm.add_quantum_error(rz_err, ["rz", "u1"], [q])
    return nm


def run_shots(N, a, n_count, noise_cfg, shots, seed, extra_noise=None):
    """Esegue il circuito `shots` volte (rumoroso se noise_cfg o extra_noise sono dati,
    altrimenti ideale). Stesso schema di quantum_backend.transpile_for/run_comparison,
    generalizzato a N/a qualsiasi. Va chiamata SEMPRE tramite run_shots_isolated: Aer con
    matrix_product_state va in segfault nel thread di Streamlit."""
    from qiskit import transpile
    from qiskit_aer import AerSimulator
    if extra_noise:
        nm = build_targeted_noise_model(noise_cfg, extra_noise)
    else:
        nm = build_noise_model(**noise_cfg) if noise_cfg else None
    qc = build_circuit(N, a, n_count)
    sim = AerSimulator(noise_model=nm, method="matrix_product_state")
    # opt_level=1 (non 2): per il ramo generico la sintesi più aggressiva di livello 2 è risultata
    # ~10x più lenta in transpile a parità di profondità finale (misurato su N=33).
    opt_level = 2 if N in LEGACY_PRESET_N else 1
    tqc = transpile(qc, sim, optimization_level=opt_level, seed_transpiler=seed)
    result = sim.run(tqc, shots=shots, seed_simulator=seed).result()
    return result.get_counts()


# ---------------------------------------------------------------------------
# Isolamento in sottoprocesso — stesso pattern di quantum_backend.py.
# ---------------------------------------------------------------------------
def _run_worker(mode, params, timeout=120):
    proc = subprocess.run(
        [sys.executable, os.path.abspath(__file__), "--mode", mode],
        input=json.dumps(params), capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Simulazione fallita nel sottoprocesso:\n{proc.stderr[-4000:]}")
    return json.loads(proc.stdout)


def _per_shot_budget(N, noise_cfg, extra_noise):
    """Secondi/shot, misurati (non stimati): il rumore rallenta Aer molto più del previsto perché
    ogni shot ricampiona gli operatori di Kraus invece di riusare un'unica evoluzione — e il
    ramo generico (N fuori dai preset legacy, circuito Beauregard) è già più pesante di suo.
    Benchmark reali su N=33 (unico N<48 osservato che arriva davvero al circuito con questa
    ricerca di base): ideale 100 shot in 18.5s (~0.19s/shot), con UC1 100 shot in 210s (~2.1s/shot)."""
    has_noise = bool(noise_cfg) or bool(extra_noise)
    if N in LEGACY_PRESET_N:
        return 0.15 if has_noise else 0.05
    return 3.0 if has_noise else 0.3


def run_shots_isolated(N, a, n_count, noise_cfg, shots, seed, extra_noise=None):
    """Timeout scalato su shot/rumore/N (vedi _per_shot_budget), non un valore fisso: un timeout
    tarato solo sul caso ideale uccideva a metà un run con rumore attivo, che è molto più lento
    (misurato: 100 shot rumorosi su N=33 impiegano ~210s, 3.5x oltre il vecchio timeout di 60s)."""
    per_shot = _per_shot_budget(N, noise_cfg, extra_noise)
    timeout = max(60, 25 + shots * per_shot * 1.4)  # +40% di margine sopra il tempo misurato
    out = _run_worker("shots", dict(N=N, a=a, n_count=n_count, noise_cfg=noise_cfg, shots=shots,
                                     seed=seed, extra_noise=extra_noise),
                       timeout=timeout)
    return out["counts"]


def _cli_main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["shots"], required=True)
    args = ap.parse_args()
    params = json.loads(sys.stdin.read())
    counts = run_shots(params["N"], params["a"], params["n_count"], params["noise_cfg"],
                        params["shots"], params["seed"], extra_noise=params.get("extra_noise"))
    print(json.dumps({"counts": counts}))


if __name__ == "__main__":
    _cli_main()
