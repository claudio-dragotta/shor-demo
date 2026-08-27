# Demo di Shor — simulatore ideale e laboratorio del rumore

Demo interattiva della tesi magistrale sull'algoritmo di Shor. La versione 3 permette di
selezionare tre istanze verificate: **N = 15, 21, 35**. Base e registro di conteggio sono
scelti dal server per impedire configurazioni aritmeticamente scorrette. L'obiettivo
non è suggerire che una QPU fisica possa essere perfetta, ma confrontare in modo controllato:

1. un **simulatore ideale**, che mostra il circuito e il post-processing di Shor senza rumore;
2. un **laboratorio di rumore**, che ripete lo stesso esperimento introducendo canali di errore
   separati o combinati.

La demo pubblica è disponibile su
[shor-demo-6knp.onrender.com](https://shor-demo-6knp.onrender.com/).

## Cosa mostra la demo

Nel percorso ideale si seguono sovrapposizione, moltiplicazione modulare controllata, QFT
inversa, misura, approssimazione con frazioni continue e calcolo dei fattori tramite MCD.
Le tre configurazioni sono:

| N | a | count | ordine | picchi teorici (arrotondati) | P(fattori) ideale |
|---:|---:|---:|---:|---|---:|
| 15 | 7 | 8 | 4 | 0, 64, 128, 192 | 75% |
| 21 | 2 | 10 | 6 | 0, 171, 341, 512, 683, 853 | 49,255% |
| 35 | 6 | 12 | 2 | 0, 2048 | 50% |

Per `N=21`, `2^10/6` non è intero: i picchi indicati sono i centri arrotondati e la legge
QPE a registro finito presenta dispersione nei bin adiacenti. La probabilità ideale è
calcolata sulla distribuzione completa, non contando soltanto i centri dei picchi.

Tutte le modalità ideali sono live. Nel laboratorio rumoroso N=15 espone tutti i canali;
N=21 espone live il readout; N=35 espone depolarizzazione, termico e readout, ma non la
sovrarotazione coerente. Il rumore interno ai gate di N=21 viene
rifiutato prima di avviare Aer: il circuito Beauregard profondo ha superato 75 secondi già
con 10 shot nei benchmark di sicurezza. Per N=35 il rumore quantistico è limitato a 32 shot;
anche qui la sovrarotazione ha superato 75 secondi con 10 shot. L'interfaccia disabilita
coerentemente quei controlli,
evitando che la presentazione resti bloccata o che un risultato approssimato venga spacciato
per simulazione completa.

Il laboratorio rumoroso mantiene visibile la baseline ideale e permette di studiare:

- depolarizzazione sulle porte a uno e due qubit;
- rilassamento energetico (`T1`) e dephasing (`T2`), con il vincolo fisico `T2 <= 2*T1`;
- errori di readout asimmetrici `P(1|0)` e `P(0|1)`;
- sovrarotazione coerente sulle porte fisiche a un qubit (`SX/X`); le `RZ` sono trattate
  come aggiornamenti virtuali del frame e non ricevono durata o rumore.

Il preset **Rumore off** disattiva tutti i canali: da lì si può abilitarne uno solo e
attribuire la variazione osservata a quel meccanismo, mantenendo invariati circuito, budget
di shot e seed radice.

Oltre al rendimento di fattorizzazione vengono riportati massa sui picchi, massa sui picchi
utili, entropia, distanza di variazione totale e distanza/fedeltà di Hellinger. Queste metriche
sono necessarie perché anche una distribuzione uniforme può produrre denominatori che superano
il post-processing. I pavimenti casuali sono `63/256` per N=15, `283/1024` per N=21 e
`675/4096` per N=35; la demo mostra automaticamente quello dell'istanza selezionata.

## Interpretazione corretta

La modalità ideale è una simulazione matematica di un circuito privo di errori, non
l'esecuzione su una “QPU senza rumore”. Il modello rumoroso è un **preset NISQ illustrativo**:
serve a isolare gli effetti dei diversi canali, ma non riproduce una specifica macchina reale.
In particolare non include una coupling map hardware, routing dipendente dal dispositivo,
calibrazioni per singolo qubit, drift temporale o crosstalk caratterizzato sperimentalmente.

Per N=15 le sfere di Bloch riguardano i qubit di conteggio. In presenza di entanglement il loro vettore
può accorciarsi perché rappresenta lo stato ridotto del singolo qubit. Un errore di readout,
invece, agisce sul bit classico dopo la misura e non deve modificare la sfera. N=21 e N=35
usano rispettivamente 22 e 26 qubit totali: la demo mostra la struttura del circuito e campiona
la legge QPE ideale esatta, evitando di materializzare statevector da milioni di ampiezze.

## Avvio locale

È richiesto Python 3.12 (la stessa versione usata dall'immagine Docker).

```bash
python -m venv .venv
# PowerShell: .venv\Scripts\Activate.ps1
# bash/zsh:   source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn server:app --reload --port 8501
```

Aprire <http://localhost:8501>. La documentazione OpenAPI è disponibile in locale su
<http://localhost:8501/api/docs>.

## Test

Le dipendenze di test sono separate da quelle runtime, così il deploy Render non installa
strumenti di sviluppo:

```bash
pip install -r requirements-dev.txt
python -m pytest
```

La suite controlla:

- truth table controllata e orbita corretta `1 → 7 → 4 → 13 → 1` del moltiplicatore
  modulare per `N=15, a=7`;
- supporto e probabilità esatte delle distribuzioni ideali `N=15/21/35`;
- post-processing dei picchi e rendimento teorico del 75%;
- pavimento casuale `63/256`;
- validazione del contratto HTTP e coerenza tra fattori dichiarati e shot riusciti;
- truth table esaustiva dei moltiplicatori Beauregard usati per `N=21` e `N=35`, inclusa
  la pulizia di registro ausiliario e ancilla;
- confronto end-to-end della QPE Beauregard con la legge teorica (TVD inferiore a
  `1,4e-9` nei casi coperti).

## API v3

L'esperimento principale usa `POST /api/experiment`. Il client sceglie `N` tra 15, 21 e 35;
`a` e `n_count` sono fissati dal server e non sono accettati dal client. `shots` deve essere
compreso tra 10 e 2048 per N=15 e tra 10 e 128 per N=21/35; il `seed` opzionale tra 0 e
2147483647. Il limite evita
che una singola prova interattiva monopolizzi a lungo le risorse del servizio Render.

Esempio di richiesta:

```json
{
  "N": 15,
  "shots": 128,
  "seed": 42,
  "noise": {
    "eps_1q": 0.001,
    "eps_2q": 0.01,
    "t1_us": 100,
    "t2_us": 80,
    "readout_0to1": 0.02,
    "readout_1to0": 0.03,
    "coherent_overrotation_deg": 0
  }
}
```

La risposta contiene la distribuzione completa sui `2^n_count` outcome, gli shot reali in ordine,
intervalli di confidenza e metriche per i casi ideale e rumoroso:

```text
schema_version, random_factor_floor
config
  └─ N, a, n_count, shots, seed, noise
ideal, noisy
  ├─ distribution, memory, iterations, shots, n_ok, factors_found
  └─ factor_yield, wilson_ci, peak_mass, useful_peak_mass, entropy_bits
comparison
  └─ tvd, hellinger_fidelity, hellinger_distance, factor_yield_delta e relativo IC Newcombe
metadata
  └─ versions, circuit, model, simulation_seeds, theoretical_peaks, useful_peaks
```

Quando il rumore è attivo, il seed richiesto genera due stream Aer deterministici distinti
per baseline e campione rumoroso; l'IC Newcombe è quindi quello per campioni indipendenti.
Con rumore nullo la memoria è riusata esattamente e l'intervallo della differenza è `[0,0]`.

`factors_found` è valorizzato soltanto se `n_ok > 0`; quando presente deve contenere una coppia
il cui prodotto è il numero selezionato. `GET /api/ideal-sample` campiona la legge QPE ideale
esatta ed è usato dalla vista strutturale di N=21/35. `GET /health` espone lo stato del servizio.

## Deploy su Render

Il repository contiene `render.yaml` e un `Dockerfile` minimale. Su Render scegliere **New →
Blueprint** e collegare il repository, oppure creare un Web Service con runtime Docker. Render
inietta `$PORT`; il container espone 8501 come valore locale predefinito e usa `/health` come
health check.

La `.dockerignore` esclude repository Git, ambienti virtuali, cache, test e documentazione dal
contesto dell'immagine. Per un'esposizione pubblica più ampia della demo didattica sono inoltre
raccomandati rate limiting a monte, limiti di timeout/memoria del container, log senza payload
completi e disabilitazione della documentazione OpenAPI in produzione.

## Ambito della demo pubblica e validazione Beauregard

I moduli Python sono copie locali (“vendored”) del progetto di tesi. La superficie HTTP v3
espone esclusivamente le tre istanze validate. N=15 mantiene il limite di 2048 shot; N=21/35
sono protette da un limite generale di 128 shot, un solo worker Aer concorrente e timeout del
sottoprocesso; su N=35 il rumore quantistico abbassa il limite a 32. Numeri arbitrari restano
fuori dal contratto pubblico.

L'aritmetica Beauregard è ora validata separatamente per tutti i moltiplicatori non banali
usati dalle istanze `N=21` (`2`, `4`, `16`) e `N=35` (`6`), su entrambi i rami del controllo,
per ogni input valido e con ancilla puliti. Anche le distribuzioni QPE complete coincidono con
la legge teorica (`TVD=1,38e-9` per `N=21, r=6`; `2,50e-13` per `N=35, r=2`). Queste istanze
sono ora esposte con limiti più stretti. La validazione aritmetica non rende retroattivamente
validi i risultati rumorosi storici, che vanno rigenerati.

Il costo è misurato nello stesso ambiente bloccato da `requirements.txt`: con Qiskit 2.5.0,
`optimization_level=2`, `seed_transpiler=20260819` e base `rz/sx/x/cx`, il circuito
`N=21, a=2, n_count=8` contiene **21.036 CX** e ha profondità **23.081**. La quantità
`(1-15 lambda_2q/16)^21036 = 7,237862389e-10` (circa `7,24e-10`) per `lambda_2q=0,001` è riportata esclusivamente come
**proxy di nessun evento 2Q indipendente**. Non è la probabilità di successo di Shor, non è
la fedeltà del circuito e non sostituisce una simulazione rumorosa.

La v2 aveva inoltre corretto il moltiplicatore textbook `N=15, a=7`: la sua orbita è
`1 → 7 → 4 → 13 → 1`. La versione precedente conservava per caso lo stesso ordine 4 e quindi
gli stessi picchi ideali, ma realizzava una permutazione diversa. Le vecchie campagne di
rumore generate con quel circuito hanno un diverso conteggio di gate e non devono essere
confrontate direttamente con la v2 senza essere rigenerate.

## Struttura

| Percorso | Ruolo |
|---|---|
| `server.py` | Applicazione FastAPI, validazione HTTP e frontend statico |
| `api_backend.py` | Esperimento ideale/rumoroso, metriche e intervalli di confidenza |
| `shor_core.py` | Circuiti validati N=15/21/35 e post-processing usati dall'API |
| `beauregard.py` | Aritmetica modulare validata usata da N=21/35 |
| `shor_general.py` | Costruzione condivisa dei tre preset e percorso locale per input generici |
| `frontend/` | Interfaccia HTML/CSS/JavaScript |
| `tests/` | Regressioni scientifiche N=15/21/35 e contratto API |
| `Dockerfile`, `render.yaml` | Build e configurazione Render |

## Riproducibilità

Specificare `seed` per ripetere esattamente il campionamento. Se viene omesso, il server ne
genera uno e lo restituisce nella risposta: conservarlo insieme ai parametri di rumore rende
l'esperimento riproducibile. Quando il rumore è attivo, il seed è una radice da cui il server
deriva stream indipendenti per ideale e rumoroso, esposti in `metadata.simulation_seeds`;
a rumore zero viene invece riusato lo stesso campione. Shot diversi sono campioni
indipendenti; non vanno chiamati
“iterazioni” nel senso delle campagne sperimentali della tesi, dove un'iterazione può indicare
un intero istogramma seguito dal post-processing. Il circuito resta invece compilato con il
seed fisso `20260819`: cambiare il seed dell'esperimento modifica il campionamento, non il
circuito confrontato.
