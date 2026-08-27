# Report di verifica demo Shor v3 — 27 agosto 2026

## Obiettivo realizzato

La demo web non è più fissata a `N=15`: l'utente può selezionare `N=15`, `N=21` oppure
`N=35`. Base `a`, registro di conteggio, ordine atteso, picchi QPE, post-processing,
pavimento casuale e limiti di esecuzione sono scelti o verificati dal server.

| N | a | count | ordine | qubit totali | vista ideale | rumore live |
|---:|---:|---:|---:|---:|---|---|
| 15 | 7 | 8 | 4 | 12 | circuito + Bloch esatto | tutti i canali, max 2048 shot |
| 21 | 2 | 10 | 6 | 22 | circuito + legge QPE esatta | readout, max 128 shot |
| 35 | 6 | 12 | 2 | 26 | circuito + legge QPE esatta | depolarizzazione, termico e readout; max 32 shot se quantistico, altrimenti 128 |

La vista Bloch di N=21/35 è sostituita intenzionalmente da una vista strutturale: gli
statevector completi richiederebbero rispettivamente circa 4 milioni e 67 milioni di
ampiezze. Le misure mostrate in questa vista provengono dalla legge QPE esatta a registro
finito, già confrontata end-to-end con Aer nei test scientifici.

## File modificati

- `experiment_backend.py`: registro delle istanze, simulazione Aer dinamica, normalizzazione
  dei bitstring, limiti per istanza/canale e timeout in sottoprocesso.
- `api_backend.py`: teoria QPE dinamica, post-processing per ogni N, misura ideale scalabile,
  distribuzioni e metadati v3.
- `server.py`: `N` ammesso nel contratto `POST /api/experiment`, endpoint
  `GET /api/ideal-sample` e validazione preventiva dei budget.
- `frontend/index.html`: selettore globale 15/21/35 e contenuti dinamici.
- `frontend/app.js`: cambio d'istanza, circuito strutturale, pipeline matematica, grafici con
  256/1024/4096 outcome e policy dei controlli di rumore.
- `frontend/style.css`: grafica del selettore, stati non disponibili e correzioni responsive.
- `tests/test_api_v2.py`: contratto API v3 e run end-to-end delle tre istanze.
- `shor_core.py`, `shor_general.py`, `README.md`: documentazione aggiornata al perimetro v3.

## Test automatici

Comando finale:

```text
python -m pytest -q --disable-warnings
```

Risultato:

```text
146 passed in 38.33s
```

Controlli aggiuntivi superati:

- `python -m py_compile` sui moduli backend;
- `node --check frontend/app.js`;
- `git diff --check`;
- nessun ID HTML duplicato e nessun riferimento `$()` JavaScript privo del relativo ID;
- homepage, JavaScript, CSS e health check restituiscono HTTP 200;
- `GET /api/factor` e `GET /api/ideal-sample` verificati per 15, 21 e 35;
- sequenza frontend reale `15 -> 21 -> 35 -> 15` verificata tramite browser headless;
- viewport mobile emulato a 390 CSS pixel: `scrollWidth=390`, nessun overflow orizzontale.

## Benchmark di sicurezza osservati

Ambiente locale: Python 3.12, Qiskit 2.3.1, Qiskit Aer 0.17.2, 10 shot salvo diversa
indicazione. I tempi servono a definire la policy della demo, non sono benchmark hardware.

- N=21 ideale: circa 5,6 s.
- N=21 con readout: circa 7,5 s.
- N=21 con depolarizzazione 1Q: oltre 75 s, timeout anche dopo un tentativo MPS limitato.
- N=35 ideale: circa 3,2 s.
- N=35 depolarizzazione 1Q: circa 5,9 s.
- N=35 depolarizzazione 2Q: circa 11,1 s.
- N=35 termico T1/T2: circa 3,4 s.
- N=35 readout: circa 1,5–2,3 s.
- N=35 preset UC1 completo: circa 9,5 s.
- N=35 sovrarotazione coerente: oltre 75 s, timeout.
- N=15: tutti i singoli canali hanno completato 10 shot in circa 0,7–0,9 s.

I due timeout misurati sono ora evitati prima di avviare il worker. L'interfaccia disabilita
gli stessi controlli che il server rifiuta, quindi non esiste un percorso UI che lanci
inconsapevolmente quei calcoli.

## Interpretazione scientifica

I risultati rumorosi sono campioni: con pochi shot un errore può casualmente aumentare il
rendimento osservato. Per questo la demo mostra anche intervalli Wilson, TVD, Hellinger,
entropia e massa sui picchi. Non si deve dedurre monotonicità da una sola realizzazione.

Il modello resta NISQ uniforme e illustrativo: non rappresenta una QPU specifica e non include
coupling map, routing hardware, drift, crosstalk o calibrazioni per singolo qubit.

