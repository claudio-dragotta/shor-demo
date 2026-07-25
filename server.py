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

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import api_backend as api

app = FastAPI(title="Demo Shor — tesi", docs_url="/api/docs")


@app.middleware("http")
async def no_cache(request, call_next):
    # Il frontend cambia spesso durante lo sviluppo: forziamo il browser a non usare la cache,
    # così ogni refresh prende l'ultima versione di app.js/style.css/index.html.
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp

_HERE = os.path.dirname(os.path.abspath(__file__))
_FRONTEND = os.path.join(_HERE, "frontend")


@app.get("/api/factor")
def api_factor(N: int = Query(..., ge=2, le=100_000)):
    try:
        return api.factor_info(N)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/bloch")
def api_bloch(N: int = Query(..., ge=2), a: int = Query(...), n_count: int = Query(..., ge=1),
              stage: int = Query(0, ge=0)):
    try:
        return api.bloch_at(N, a, n_count, stage)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/run")
def api_run(N: int = Query(..., ge=2), a: int = Query(...), n_count: int = Query(..., ge=1),
            noise: str = Query("none"), shots: int = Query(100, ge=1, le=8192)):
    try:
        return api.run_stats(N, a, n_count, noise, shots)
    except Exception as e:  # subprocess/timeout inclusi: messaggio pulito al frontend
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/health")
def health():
    return JSONResponse({"ok": True})


# Frontend statico (montato per ultimo cosi' /api/* ha precedenza)
@app.get("/")
def index():
    return FileResponse(os.path.join(_FRONTEND, "index.html"))


app.mount("/", StaticFiles(directory=_FRONTEND, html=True), name="static")
