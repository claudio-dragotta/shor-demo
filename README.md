# Shor demo — interactive simulator

Interactive web demo for the master's thesis *"Shor's algorithm on NISQ hardware & Quantum
Error Correction"*: factor a number with Shor while watching the **circuit** and a **Bloch
sphere per qubit** evolve stage by stage, then repeat the measurement over many iterations to
see how the result emerges.

Live circuit + Bloch state are computed with **Qiskit** (real statevector, per-qubit reduced
density matrix); the multi-run statistics use **Qiskit Aer**. Backend **FastAPI**, frontend
plain HTML/CSS/JS (no framework).

This is a standalone deploy repo. The `shor_core.py` and `beauregard.py` modules are vendored
from the thesis monorepo (`Extra/experiments/campagne_classiche_M1-M4/`); the numbers stay
identical to the validated thesis campaigns.

## Run locally

```bash
pip install -r requirements.txt
uvicorn server:app --reload --port 8501
# apre http://localhost:8501
```

## Deploy on Render

Render → **New → Blueprint** → select this repo. It reads `render.yaml` (Docker, `plan:
starter` = always-on; change to `free` for the spin-down free tier). Or **New → Web Service**
→ Runtime *Docker*, Dockerfile `./Dockerfile`.

`$PORT` is injected automatically; health check at `/health`.

**Auto-deploy:** `autoDeploy` is on, so every push to `main` redeploys.

## What it does

- **Senza rumore**: one run at a time — the playhead sweeps the circuit, the Bloch spheres
  evolve (superposition → entanglement → collapse). If the measured outcome doesn't yield the
  factors, a banner explains it's probabilistic and lets you choose how many iterations to run
  — then each iteration is animated and its result shown.
- **Con rumore**: adds the NISQ noise presets (UC1 / UC2) to the statistics.
- Best experience at **N = 15** (12 qubits, fast). Larger N (e.g. 21, 35) are shown as a
  static circuit with a note — they are too large to simulate live, which is exactly why
  Shor's algorithm is hard to simulate classically.

## Files

| File | Role |
|---|---|
| `server.py` | FastAPI app: serves the frontend + `/api/factor`, `/api/bloch`, `/api/run`, `/health` |
| `api_backend.py` | Factor pre-processing, per-stage Bloch (statevector + partial trace), run statistics |
| `shor_general.py` | Free-N Shor circuit (reuses `shor_core` for N∈{15,21,35}, Beauregard otherwise) |
| `shor_core.py`, `beauregard.py` | Vendored from the thesis (validated circuits) |
| `frontend/` | `index.html`, `style.css`, `app.js` |
| `Dockerfile`, `render.yaml` | Container build + Render Blueprint |
