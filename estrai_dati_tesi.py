#!/usr/bin/env python3
"""Estrae dagli artefatti validati della tesi le curve che la demo mostra.

La demo non ricalcola nulla di tutto questo: sono campagne che girano per ore.
Qui si prendono i risultati gia' prodotti e verificati, si riducono a poche
decine di punti e si scrivono in `precomputed/tesi.json`, che viaggia
nell'immagine e viene servito come dato statico.

Ogni curva porta la propria provenienza -- file d'origine, shot, repliche --
perche' un numero mostrato senza da dove viene non e' citabile (regola 5 del
CLAUDE.md della tesi).

Le sorgenti sono quelle canoniche:
  M5  repetition code, curva misurata + legge teorica 3p^2-2p^3
  M6  Steane [[7,1,3]], soppressione quadratica
  M7  surface code, tabella per distanza + soglia stimata
  M8  sensibilita' di Shor all'errore logico per-gate (artefatto v2)

Uso:  python estrai_dati_tesi.py
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TESI = os.path.abspath(os.path.join(HERE, "..", ".."))
USCITA = os.path.join(HERE, "precomputed", "tesi.json")

SORGENTI = {
    "repetition": "Extra/experiments/M5_repetition_code/results_M5_repetition_Z_20260709_115213.json",
    "steane": "Extra/experiments/M6_steane_code/results_M6_steane_20260709_155832.json",
    "surface": "Extra/experiments/M7_surface_code/results_M7_surface_z_20260808_001903.json",
    "shor_logico": ("Extra/experiments/M8_shor_logico/artifacts/v2_20260819/"
                    "results_M8_shor_logico_v2_20260826_123421.json"),
}


def leggi(chiave: str) -> dict:
    percorso = os.path.join(TESI, SORGENTI[chiave])
    if not os.path.exists(percorso):
        raise SystemExit(f"Sorgente mancante: {percorso}")
    with open(percorso, encoding="utf-8") as fh:
        return json.load(fh)


def arrotonda(x, cifre=6):
    return None if x is None else round(float(x), cifre)


def adatta_legge_di_scala(tabella: dict, p_max: float = 0.006) -> dict:
    """Fit ai minimi quadrati di  ln p_L = ln A + ((d+1)/2) (ln p - ln p_th).

    Sotto soglia la legge e' lineare in ln p, con pendenza fissata dalla
    distanza: restano due incognite, ln A e ln p_th. Si usano solo i punti con
    p <= p_max, dove la legge vale; sopra soglia la soppressione si inverte e
    includerli falserebbe il fit.
    """
    import math

    righe = []
    for d_str, punti in tabella.items():
        d = int(d_str)
        k = (d + 1) / 2.0
        for x in punti:
            p, pL = float(x["p"]), float(x["p_L"])
            if p <= p_max and pL > 0:
                righe.append((k, math.log(p), math.log(pL)))
    if len(righe) < 3:
        raise SystemExit("Troppi pochi punti per il fit della legge di scala.")

    # Incognite: u = ln A, v = ln p_th.  modello: y = u + k*x - k*v
    # -> y - k*x = u - k*v : regressione lineare di (y - k*x) su k.
    ks = [r[0] for r in righe]
    zs = [r[2] - r[0] * r[1] for r in righe]
    n = len(righe)
    mk = sum(ks) / n
    mz = sum(zs) / n
    sxx = sum((k - mk) ** 2 for k in ks)
    sxy = sum((k - mk) * (z - mz) for k, z in zip(ks, zs))
    pendenza = sxy / sxx          # = -v
    intercetta = mz - pendenza * mk   # = u
    A = math.exp(intercetta)
    p_th = math.exp(-pendenza)
    residui = [z - (intercetta + pendenza * k) for k, z in zip(ks, zs)]
    rms = math.sqrt(sum(r * r for r in residui) / n)
    return {"A": A, "p_th": p_th, "rms": rms, "n": n}


def costo_correzione(A: float, p_th: float, qubit_per_distanza=lambda d: 2 * d * d - 1) -> list:
    """Quanti qubit fisici servono per un qubit logico, a bersaglio dato.

    E' la traduzione della legge di scala in un prezzo: sotto soglia si compra
    affidabilita' con la distanza, e la distanza costa qubit. Il conteggio
    2d^2-1 e' quello del surface code ruotato.
    """
    import math

    fuori = []
    for p in (0.002, 0.001, 0.0005):
        voci = []
        for bersaglio in (1e-4, 1e-6, 1e-9, 1e-12):
            d = 3
            while d <= 99:
                if A * (p / p_th) ** ((d + 1) / 2.0) <= bersaglio:
                    break
                d += 2
            voci.append({"bersaglio": bersaglio, "d": d, "qubit": qubit_per_distanza(d)})
        fuori.append({"p": p, "voci": voci})
    return fuori


def main() -> int:
    # --- M5: repetition -----------------------------------------------------
    m5 = leggi("repetition")["curve"]
    repetition = {
        "fonte": os.path.basename(SORGENTI["repetition"]),
        "shots": m5.get("shots"),
        "base": m5.get("basis"),
        "legge": "p_L = 3p^2 - 2p^3",
        "punti": [{"p": arrotonda(x["p"]), "pL": arrotonda(x["p_L"]),
                   "se": arrotonda(x.get("p_L_se")), "teoria": arrotonda(x.get("p_L_theory"))}
                  for x in m5["points"]],
    }

    # --- M6: Steane ---------------------------------------------------------
    m6 = leggi("steane")["curve"]
    steane = {
        "fonte": os.path.basename(SORGENTI["steane"]),
        "shots": m6.get("shots"),
        "punti": [{"p": arrotonda(x["p"]), "pL": arrotonda(x["p_L"]), "se": arrotonda(x.get("p_L_se"))}
                  for x in m6["points"]],
    }

    # --- M7: surface --------------------------------------------------------
    # Il campo `threshold` del JSON e' la stima grezza dall'attraversamento
    # sulla griglia (0,9% per Z): NON e' il numero citabile. Quello viene dal
    # fit della legge di scala, che qui si rifa' dai punti misurati invece di
    # copiarlo dal log -- cosi' e' riproducibile e verificabile.
    m7 = leggi("surface")["curve"]
    fit = adatta_legge_di_scala(m7["table"])
    surface = {
        "fonte": os.path.basename(SORGENTI["surface"]),
        "base": m7.get("basis"),
        "cicli": m7.get("rounds"),
        "soglia_griglia": m7.get("threshold"),
        "legge": "p_L = A (p/p_th)^((d+1)/2)",
        "A": arrotonda(fit["A"], 5),
        "p_th": arrotonda(fit["p_th"], 5),
        "rms_ln": arrotonda(fit["rms"], 4),
        "punti_usati_nel_fit": fit["n"],
        "costo": costo_correzione(fit["A"], fit["p_th"]),
        "distanze": {
            d: [{"p": arrotonda(x["p"]), "pL": arrotonda(x["p_L"]),
                 "se": arrotonda(x.get("p_L_se")), "shots": x.get("shots")}
                for x in punti]
            for d, punti in sorted(m7["table"].items(), key=lambda kv: int(kv[0]))
        },
    }

    # --- M8: sensibilita' di Shor ------------------------------------------
    doc8 = leggi("shor_logico")
    c8 = doc8["curve"]
    shor = {
        "fonte": os.path.basename(SORGENTI["shor_logico"]),
        "schema_version": doc8.get("schema_version"),
        "generato_il": doc8.get("generated_at"),
        "N": c8.get("N"), "a": c8.get("a"), "n_count": c8.get("n_count"),
        "repliche": c8.get("replicate_count"),
        "shot_per_replica": c8.get("shots_per_replicate"),
        "P_ideale": arrotonda(c8.get("P_ideal")),
        "P_al_massimo": arrotonda(c8.get("P_at_max_p")),
        "monotona": bool(c8.get("monotonicity", {}).get("monotone_compatible")),
        "punti": [{"pL": arrotonda(x["p_L"]), "P": arrotonda(x["P_success"]),
                   "lo": arrotonda(x["wilson_ci"]["low"]), "hi": arrotonda(x["wilson_ci"]["high"])}
                  for x in c8["points"]],
    }
    # Il pavimento uniforme e' una proprieta' dell'istanza, non della curva:
    # frazione di esiti da cui il post-processing estrae comunque i fattori.
    shor["pavimento_uniforme"] = 63 / 256

    documento = {
        "schema_version": "1.0",
        "generato": _dt.datetime.now().isoformat(timespec="seconds"),
        "nota": ("Curve estratte dagli artefatti validati della tesi, non ricalcolate dalla demo. "
                 "p e' l'errore fisico per gate; p_L in M8 e' un proxy fenomenologico logico "
                 "per-gate e NON e' la stessa grandezza misurata da M5/M6/M7."),
        "qec": {"repetition": repetition, "steane": steane, "surface": surface},
        "shor_logico": shor,
    }

    os.makedirs(os.path.dirname(USCITA), exist_ok=True)
    with open(USCITA, "w", encoding="utf-8") as fh:
        json.dump(documento, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"Scritto {os.path.relpath(USCITA, HERE)} ({os.path.getsize(USCITA)/1024:.1f} KB)")
    print(f"  repetition : {len(repetition['punti'])} punti  ({repetition['shots']} shot)")
    print(f"  Steane     : {len(steane['punti'])} punti  ({steane['shots']} shot)")
    for d, punti in surface["distanze"].items():
        print(f"  surface d={d}: {len(punti)} punti")
    print(f"  surface: fit A={surface['A']} p_th={surface['p_th']} "
          f"(RMS ln {surface['rms_ln']}, {surface['punti_usati_nel_fit']} punti)")
    print(f"           stima grezza da griglia: {surface['soglia_griglia']}")
    for riga in surface["costo"][:1]:
        for v in riga["voci"]:
            print(f"           p={riga['p']}  p_L<={v['bersaglio']:.0e}  ->  d={v['d']}  {v['qubit']} qubit")
    print(f"  Shor logico: {len(shor['punti'])} punti  "
          f"({shor['repliche']} repliche x {shor['shot_per_replica']} shot)")
    print(f"  P ideale {shor['P_ideale']} -> pavimento {shor['pavimento_uniforme']:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
