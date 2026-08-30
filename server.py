"""Demo interattiva della tesi — server FastAPI.

Stessa architettura della dashboard del progetto QSDN (FastAPI + frontend statico), ma il
frontend e' quello di questa tesi (circuito di Shor + sfere di Bloch collegate). Il backend
riusa il Qiskit gia' validato via api_backend.py.

Avvio locale:
    pip install -r requirements.txt
    uvicorn server:app --reload --port 8501

Deploy (Render / Docker): CMD uvicorn server:app --host 0.0.0.0 --port $PORT
"""
import os
from threading import BoundedSemaphore
from typing import Literal
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, model_validator

import api_backend as api
from experiment_backend import (
    MAX_SHOTS,
    SimulationUnavailable,
    validate_live_experiment,
)

app = FastAPI(title="Demo Shor — tesi", docs_url="/api/docs")


class NoiseConfig(BaseModel):
    """Canali indipendenti del modello NISQ uniforme e illustrativo."""

    model_config = ConfigDict(extra="forbid")

    eps_1q: float = Field(0.0, ge=0.0, le=1.0, allow_inf_nan=False, strict=True)
    eps_2q: float = Field(0.0, ge=0.0, le=1.0, allow_inf_nan=False, strict=True)
    t1_us: float | None = Field(None, gt=0.0, allow_inf_nan=False, strict=True)
    t2_us: float | None = Field(None, gt=0.0, allow_inf_nan=False, strict=True)
    readout_0to1: float = Field(0.0, ge=0.0, le=1.0, allow_inf_nan=False, strict=True)
    readout_1to0: float = Field(0.0, ge=0.0, le=1.0, allow_inf_nan=False, strict=True)
    coherent_overrotation_deg: float = Field(
        0.0, ge=-180.0, le=180.0, allow_inf_nan=False, strict=True
    )

    @model_validator(mode="after")
    def validate_relaxation_times(self):
        if (self.t1_us is None) != (self.t2_us is None):
            raise ValueError("t1_us e t2_us devono essere specificati insieme")
        if self.t1_us is not None and self.t2_us > 2.0 * self.t1_us:
            raise ValueError("il modello fisico richiede T2 <= 2*T1")
        return self


class ExperimentRequest(BaseModel):
    """Il client sceglie N; base e dimensione restano configurazioni server-side validate."""

    model_config = ConfigDict(extra="forbid")

    N: Literal[15, 21, 35] = 15
    shots: int = Field(128, ge=10, le=MAX_SHOTS, strict=True)
    seed: int | None = Field(None, ge=0, le=2 ** 31 - 1, strict=True)
    noise: NoiseConfig = Field(default_factory=NoiseConfig)

    @model_validator(mode="after")
    def validate_instance_budget(self):
        validate_live_experiment(self.N, self.shots, self.noise.model_dump())
        return self


@app.middleware("http")
async def cache_policy(request, call_next):
    """Politica di cache: mai per l'API, sempre da rivalidare per gli asset.

    Le risposte di /api/* dipendono da seed e rumore: riusarle sarebbe sbagliato,
    quindi ``no-store``.

    Sugli asset la versione precedente si limitava a ETag e Last-Modified,
    contando sul fatto che il browser rivalidasse. Non e' cosi': **senza**
    ``Cache-Control`` il browser applica la cache euristica (RFC 9111) e puo'
    considerare fresca una risposta per giorni, senza chiedere nulla al server.
    Dopo un deploy si vedeva ancora la pagina vecchia -- osservato: index.html e
    style.css nuovi sul server, ma il browser continuava a mostrare i vecchi
    finche' non si forzava il ricaricamento.

    ``no-cache`` non vieta la cache: obbliga a rivalidare prima di riusarla. Il
    browser manda If-None-Match, riceve 304 e non riscarica nulla se il file non
    e' cambiato. Costa un giro di rete e garantisce che un deploy si veda subito.
    """
    resp = await call_next(request)
    resp.headers["Cache-Control"] = (
        "no-store" if request.url.path.startswith("/api/") else "no-cache"
    )
    return resp

_HERE = os.path.dirname(os.path.abspath(__file__))
_FRONTEND = os.path.join(_HERE, "frontend")
# Un singolo worker Aer puo' gia' usare una quota significativa di CPU e memoria sul piano
# Render della demo. Rifiutare subito una seconda simulazione evita code incontrollate e OOM.
_SIMULATION_SLOT = BoundedSemaphore(value=1)


def _with_simulation_slot(callback):
    if not _SIMULATION_SLOT.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="Un esperimento e' gia' in esecuzione. Riprova tra qualche secondo.",
            headers={"Retry-After": "5"},
        )
    try:
        return callback()
    finally:
        _SIMULATION_SLOT.release()


@app.get("/api/factor")
def api_factor(N: int = Query(..., ge=2, le=1000)):
    try:
        return api.factor_info(N)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/bloch")
def api_bloch(N: int = Query(..., ge=2, le=1000), a: int = Query(...), n_count: int = Query(..., ge=1),
              stage: int = Query(0, ge=0),
              seed: int | None = Query(None, ge=0, le=2 ** 31 - 1)):
    try:
        return api.bloch_at(N, a, n_count, stage, seed=seed)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="Vista di Bloch temporaneamente non disponibile.")


@app.get("/api/ideal-sample")
def api_ideal_sample(
    N: int = Query(..., ge=2, le=1000),
    seed: int | None = Query(None, ge=0, le=2 ** 31 - 1),
):
    """Misura ideale scalabile per le istanze la cui vista Bloch sarebbe troppo grande."""
    try:
        return api.ideal_sample(N, seed=seed)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/circuit-cost")
def api_circuit_cost(N: int = Query(..., ge=2, le=1000)):
    """Su quante porte agisce ogni canale: alimenta l'anatomia del rumore."""
    try:
        return api.circuit_cost(N)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class NoisyBlochRequest(BaseModel):
    """Sfere di Bloch sotto rumore: solo N=15, l'unica istanza in cui la
    matrice densita' resta calcolabile (12 qubit, 4096x4096)."""

    model_config = ConfigDict(extra="forbid")

    N: Literal[15] = 15
    noise: NoiseConfig = Field(default_factory=NoiseConfig)


@app.post("/api/noisy-bloch")
def api_noisy_bloch(request: NoisyBlochRequest):
    """Stato ridotto dei qubit di conteggio a ogni stadio, con e senza rumore."""
    try:
        return _with_simulation_slot(
            lambda: api.noisy_bloch(request.N, request.noise.model_dump())
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SimulationUnavailable:
        raise HTTPException(status_code=503, detail="Vista di Bloch temporaneamente non disponibile.")
    except Exception:
        raise HTTPException(status_code=500, detail="Errore interno durante il calcolo dello stato.")


@app.post("/api/experiment")
def api_experiment(request: ExperimentRequest):
    """Confronta la baseline ideale con lo stesso circuito sotto i canali scelti."""
    try:
        return _with_simulation_slot(
            lambda: api.run_experiment(
                N=request.N,
                shots=request.shots,
                seed=request.seed,
                noise=request.noise.model_dump(),
            )
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SimulationUnavailable:
        raise HTTPException(status_code=503, detail="Simulazione temporaneamente non disponibile.")
    except Exception:
        raise HTTPException(status_code=500, detail="Errore interno durante la simulazione.")


@app.get("/api/curve-tesi")
def api_curve_tesi():
    """Curve validate della tesi: QEC (M5/M6/M7) e sensibilita' di Shor (M8).

    Dato statico letto da file, non una simulazione: nessun semaforo, nessun
    costo. Vuoto se il file non e' stato generato -- il frontend nasconde la
    sezione invece di mostrare grafici senza dati.
    """
    return api.curve_tesi()


@app.get("/health")
def health():
    return JSONResponse({"ok": True})


# Frontend statico (montato per ultimo cosi' /api/* ha precedenza)
@app.get("/")
def index():
    return FileResponse(os.path.join(_FRONTEND, "index.html"))


app.mount("/", StaticFiles(directory=_FRONTEND, html=True), name="static")
