"use strict";

/* Scheda 03 · QFT approssimata.

   Mostra il troncamento della campagna M15 sul circuito della demo (N=15, a=7, n=8):
   quali rotazioni della QFT inversa si tolgono a ogni grado k, quanto costa dopo la
   compilazione, che cosa cambia senza rumore e che cosa con il rumore illustrativo.
   In fondo, i numeri della tesi letti dagli artefatti M15, tenuti separati dai numeri
   live perche' vengono da un altro modello di rumore (FakeSherbrooke, porte ECR).

   Il file porta con se' il proprio dizionario: le chiavi entrano in I18N prima che
   app.js applichi i testi statici. */
(() => {
  const I18N = window.I18N;

  I18N.extend("it", {
    "doc.description": "Demo didattica dell'algoritmo di Shor: simulazione ideale, laboratorio del rumore quantistico e QFT approssimata.",
    "tab.aqft.name": "QFT approssimata",
    "tab.aqft.desc": "Meno rotazioni, meno porte, meno rumore",

    "aq.kicker": "QFT approssimata · N = 15",
    "aq.title": "Togliere rotazioni per togliere rumore",
    "aq.intro": "La QFT inversa usa rotazioni controllate sempre più piccole: fra due qubit a distanza <span class=\"mono\">d</span> l’angolo è <span class=\"mono\">π/2ᵈ</span>, ma il prezzo è sempre lo stesso, due porte CX. L’<strong>AQFT</strong> tiene solo le rotazioni con <span class=\"mono\">d ≤ k</span>: meno porte, quindi meno occasioni di errore, al rischio di perdere precisione sulla fase. È il troncamento della campagna M15 della tesi.",
    "aq.badge.instance": "Istanza",
    "aq.badge.register": "Registro",
    "aq.badge.rotations": "Rotazioni",
    "aq.k.label": "Grado di troncamento",
    "aq.k.aria": "Grado di troncamento k della QFT inversa",
    "aq.k.full": "k = {k} · QFT piena: tutte le 28 rotazioni.",
    "aq.k.help": "k = {k} · si tengono le rotazioni fino a π/{den}; ne restano {kept} su 28.",
    "aq.tick.full": "piena",

    "aq.circuit.kicker": "Il circuito",
    "aq.circuit.title": "QFT approssimata sul registro di conteggio",
    "aq.circuit.intro": "Il circuito che gira con il grado scelto: prima i quattro SWAP che invertono l’ordine dei bit, poi per ogni qubit le rotazioni controllate che restano e infine una Hadamard. Le rotazioni tolte non ci sono più: a k = 7 è la QFT inversa piena, abbassando k il circuito si accorcia. L’anello giallo segna <strong>l’unica rotazione che su N = 15 agisce davvero</strong>.",
    "aq.circuit.scroller": "Circuito della QFT inversa, scorrevole orizzontalmente",
    "aq.circuit.chip": "{kept}/28 rotazioni",
    "aq.circuit.svgTitle": "QFT inversa a 8 qubit con grado di troncamento k = {k}",
    "aq.circuit.svgDesc": "Quattro SWAP, poi per ogni qubit j le rotazioni controllate di angolo π/2^(j−m) con j − m ≤ {k} e una Hadamard: restano {kept} rotazioni su 28, le {removed} tolte non compaiono.",
    "aq.circuit.block": "c{j}",
    "aq.circuit.only": "l’unica che agisce",
    "aq.legend.kept": "rotazione tenuta",
    "aq.legend.h": "Hadamard",
    "aq.legend.swap": "SWAP di inversione",
    "aq.dist.head": "d = {d}",
    "aq.dist.angle": "angolo π/{den}",
    "aq.dist.pairs": "{n} coppie",
    "aq.dist.cost": "{cx} CX",
    "aq.dist.kept": "tenute",
    "aq.dist.removed": "tolte",

    "aq.cost.kicker": "Dopo la compilazione",
    "aq.cost.title": "Quanto costa il circuito intero",
    "aq.cost.intro": "Circuito di Shor completo, compilato come nel laboratorio del rumore (base rz/sx/x/cx, livello 2, seed fisso). Le rz sono virtuali e non portano rumore: conta soprattutto quante CX restano.",
    "aq.cost.cx": "CX (2 qubit)",
    "aq.cost.sx": "SX/X (1 qubit)",
    "aq.cost.rz": "RZ virtuali",
    "aq.cost.depth": "Profondità",
    "aq.cost.full": "piena",
    "aq.cost.aqft": "k = {k}",
    "aq.cost.same": "invariato",
    "aq.cost.source": "Base {basis} · seed transpiler {seed} · a k = 7 il circuito compilato coincide con quello canonico della tesi (SHA-256 {sha}…){check}",
    "aq.cost.checkOk": " ✓",
    "aq.cost.checkKo": " — ATTENZIONE: SHA diverso dal canonico",

    "aq.ideal.kicker": "Senza rumore",
    "aq.ideal.title": "Che cosa si perde troncando",
    "aq.ideal.full": "Ideale · QFT piena",
    "aq.ideal.aqft": "Ideale · k = {k}",
    "aq.ideal.tvd": "Distanza dalla piena",
    "aq.ideal.yieldHelp": "probabilità esatta di estrarre i fattori",
    "aq.ideal.tvdHelp": "TVD fra le due distribuzioni esatte, entro l’arrotondamento numerico",
    "aq.ideal.zero": "0",
    "aq.phase.title": "Perché su N = 15 non si perde nulla",
    "aq.phase.text": "Con ordine r = 4 le fasi sono s/4. In ogni ramo il registro termina su uno di questi quattro valori y, e in binario solo i due bit più alti, b7 e b6, possono valere 1:",
    "aq.phase.after": "Ogni rotazione della QFT inversa è controllata da un qubit già elaborato, che a quel punto vale proprio il suo bit del risultato. I bit b0…b5 valgono sempre 0, quindi le rotazioni che controllano sono l’identità: <strong>delle 28 ne agisce una sola, c6 → c7</strong>, che ha distanza 1 ed è tenuta da ogni k ≥ 1.",
    "aq.phase.n21": "Su N = 21 l’ordine è r = 6 e le fasi j/6 non si scrivono con pochi bit: lì le rotazioni fini portano informazione e troncare costa resa anche senza rumore.",
    "aq.ideal.verdict": "A k = {k} la distribuzione ideale è identica a quella della QFT piena: resa {y}. Si tolgono {cx} CX senza perdere nulla.",
    "aq.ideal.verdictFull": "La QFT piena è il riferimento: resa ideale {y}, i picchi esatti in 0, 64, 128 e 192.",

    "aq.run.kicker": "Con rumore · simulazione live",
    "aq.run.title": "QFT piena contro QFT approssimata",
    "aq.run.intro": "I due circuiti girano su Aer con <strong>lo stesso modello di rumore</strong> e lo stesso numero di shot, ma con seed indipendenti, così l’intervallo di Newcombe sulla differenza è corretto. È il modello <strong>uniforme e illustrativo</strong> del laboratorio, non la calibrazione di una QPU.",
    "aq.run.btn": "Confronta le due trasformate",
    "aq.run.running": "Simulazione in corso: QFT piena e k = {k}, {shots} shot ciascuna…",
    "aq.run.done": "Confronto completato in {s} s.",
    "aq.run.error": "Confronto non riuscito: {msg}",
    "aq.run.busy": "Un’altra simulazione è in corso: riprova fra qualche secondo.",
    "aq.run.stale": "Il grado o il preset sono cambiati dopo l’ultimo confronto: i risultati sotto si riferiscono a k = {k}, {preset}.",
    "aq.run.empty.title": "Nessun confronto ancora eseguito",
    "aq.run.empty.text": "Scegli un grado e un preset, poi avvia: i due circuiti girano con lo stesso rumore e gli stessi shot.",
    "aq.run.fullOnly": "Con k = 7 i due circuiti sono identici: scegli un grado più basso per vedere l’effetto del troncamento.",
    "aq.snapshot": "{preset}: {canali}",
    "aq.snapshot.thermalOff": "T₁/T₂ spenti",
    "aq.kpi.full": "QFT piena · P(fattori)",
    "aq.kpi.aqft": "AQFT k = {k} · P(fattori)",
    "aq.kpi.delta": "Differenza AQFT − piena",
    "aq.kpi.cx": "CX risparmiate",
    "aq.kpi.peaks": "Massa sui picchi",
    "aq.kpi.ci": "IC 95% [{lo}; {hi}]",
    "aq.kpi.deltaCi": "Newcombe 95% [{lo}; {hi}]",
    "aq.kpi.cxHelp": "{full} → {aqft} porte a due qubit",
    "aq.kpi.peaksHelp": "piena {full} · AQFT {aqft}",
    "aq.kpi.verdict.better": "L’AQFT rende di più: l’intervallo esclude lo zero.",
    "aq.kpi.verdict.worse": "L’AQFT rende di meno: l’intervallo esclude lo zero.",
    "aq.kpi.verdict.none": "Differenza non risolta con questi shot: l’intervallo contiene lo zero.",
    "aq.series.full": "QFT piena",
    "aq.series.aqft": "AQFT k = {k}",
    "aq.chart.title": "Distribuzione degli esiti sotto rumore",
    "aq.chart.help": "Ogni barra è un valore misurato del registro (0–255). Le linee tratteggiate sono i picchi teorici 0, 64, 128, 192.",
    "aq.chart.svgTitle": "Distribuzioni rumorose di QFT piena e AQFT k = {k}",
    "aq.chart.summary": "Sui picchi teorici: QFT piena {full}, AQFT {aqft}. Il resto della massa è sparso dal rumore sugli altri {n} valori.",
    "aq.chart.bar": "{serie} · valore {v}: {p} ({c} shot)",
    "aq.prov.title": "Provenienza del confronto",
    "aq.prov.instance": "Istanza",
    "aq.prov.degree": "Grado",
    "aq.prov.shots": "Shot per braccio",
    "aq.prov.seeds": "Seed Aer",
    "aq.prov.seedsVal": "piena {full} · AQFT {aqft} (indipendenti)",
    "aq.prov.noise": "Rumore",
    "aq.prov.model": "Modello",
    "aq.prov.modelVal": "uniforme illustrativo, rz virtuali, base rz/sx/x/cx",
    "aq.prov.method": "Differenza",
    "aq.prov.methodVal": "Newcombe (Wilson) per campioni indipendenti, 95%",

    "aq.curve.kicker": "Tutti i gradi · dati precalcolati",
    "aq.curve.title": "Dove sta il grado migliore",
    "aq.curve.intro": "Resa in fattori per ogni k sotto i tre preset, con gli stessi circuiti compilati e lo stesso modello illustrativo. La linea viola è la resa ideale, che non dipende da k; quella rossa è il pavimento di chi tira a caso.",
    "aq.curve.chart": "Resa in fattori contro grado k",
    "aq.curve.help": "{shots} shot per punto, barre = IC di Wilson al 95%. Il punto cerchiato è il grado scelto sopra.",
    "aq.curve.axisX": "grado di troncamento k (7 = QFT piena)",
    "aq.curve.axisY": "P(fattori)",
    "aq.curve.ideal": "ideale {v}",
    "aq.curve.floor": "a caso {v}",
    "aq.curve.verdict": "Sotto {preset} la resa sale da {full} con la QFT piena a {best} con k = {k}: {delta}. Il guadagno cresce con il rumore sulle porte, perché ogni porta tolta toglie un’occasione di errore; con il solo readout è nullo, perché l’errore di misura arriva dopo il circuito.",
    "aq.curve.source": "precomputed/aqft_curva.json · seed {seed} + regola dichiarata · generato {date} · circuito pieno SHA {sha}…",
    "aq.curve.note": "Il grado migliore qui è letto sugli stessi dati che lo stimano: è un’indicazione visiva. La selezione con holdout disgiunto è quella della tesi, qui sotto.",

    "aq.thesis.kicker": "Dalla tesi · campagna M15",
    "aq.thesis.title": "Che cosa ha misurato la tesi",
    "aq.thesis.intro": "Questi numeri non sono calcolati dalla demo: sono letti dagli artefatti M15 (<span class=\"mono\">schema 2.0</span>, seed e manifest registrati). Il rumore è una snapshot offline <strong>FakeSherbrooke</strong> con porte ECR e layout fisso: un modello diverso da quello sopra, quindi i valori non si confrontano cifra per cifra.",
    "aq.thesis.n15.title": "Shor N = 15 su snapshot FakeSherbrooke",
    "aq.thesis.n15.help": "8 192 shot per grado in 8 batch: il grado si sceglie sui 4 batch di selezione e si riporta sui 4 di holdout, disgiunti.",
    "aq.thesis.n15.svgTitle": "Resa su holdout per grado k, campagna M15 N = 15",
    "aq.thesis.n15.svgDesc": "Resa su holdout da k = 1 a k = 7 con le ECR compilate di ogni grado.",
    "aq.thesis.n15.axisY": "P(fattori) holdout",
    "aq.thesis.n15.ecr": "ECR",
    "aq.thesis.col.k": "k",
    "aq.thesis.col.ecr": "ECR",
    "aq.thesis.col.depth": "Profondità",
    "aq.thesis.col.train": "Selezione",
    "aq.thesis.col.holdout": "Holdout",
    "aq.thesis.selected": "scelto",
    "aq.thesis.full": "piena",
    "aq.thesis.n15.verdict": "Scelto k = {k} sulla selezione. Sull’holdout la resa sale da {full} a {sel}: <strong>{delta}</strong>, IC Newcombe 95% [{lo}; {hi}], con {ecr} ECR in meno ({ref} → {now}). Il risultato è però <strong>favorito per costruzione</strong>: su N = 15 troncare non costa nulla neppure in teoria, come mostra la sezione ideale sopra.",
    "aq.thesis.n15.source": "{file} · seed {seed} · calibrazione SHA {cal}… · circuito canonico SHA {sha}…",
    "aq.thesis.n21.title": "Shor N = 21: il test discriminante",
    "aq.thesis.n21.help": "Qui la QFT sta anche dentro gli addizionatori di Beauregard: troncarla (k_arith = 1) dimezza le ECR, ma le fasi j/6 richiedono le rotazioni fini. Holdout da 128 shot per braccio, rumore di calibrazione scalato.",
    "aq.thesis.n21.factor": "Fattore rumore",
    "aq.thesis.n21.full": "Piena",
    "aq.thesis.n21.trunc": "Troncata",
    "aq.thesis.n21.delta": "Differenza [IC 95%]",
    "aq.thesis.n21.verdict": "ECR da {full} a {trunc} (−{pct}), ma in nessun regime l’approssimazione mostra un vantaggio. A rumore 0,003, l’unico livello con segnale, è la QFT piena a staccarsi dal pavimento.",
    "aq.thesis.n21.source": "{n} artefatti di sensibilità M15 · contrasto ricalcolato dai conteggi holdout con newcombe_diff_ci di qft_approssimata.py",
    "aq.thesis.qpe.title": "Stima di fase isolata (M15b)",
    "aq.thesis.qpe.help": "Senza l’aritmetica modulare il circuito costa decine di porte e sopravvive al rumore: tre taglie di registro, tre fasi per taglia, grado scelto su selezione e riportato su holdout.",
    "aq.thesis.qpe.svgTitle": "Differenza di resa AQFT meno QFT piena nei nove benchmark di stima di fase",
    "aq.thesis.qpe.svgDesc": "Intervalli di Newcombe al 95% per ogni combinazione di taglia del registro e fase.",
    "aq.thesis.qpe.axis": "differenza AQFT − piena",
    "aq.thesis.qpe.exact": "esatta",
    "aq.thesis.qpe.verdict": "Stima positiva in {pos} confronti su {n}, intervallo sopra lo zero in {ex}. Il massimo è {max} con n = {nmax}, dove si risparmiano {ecr} ECR.",
    "aq.thesis.qpe.source": "{file} · {shots} shot per grado, 8 batch",
    "aq.thesis.caveat": "<strong>Lettura corretta.</strong> L’AQFT conviene quando le porte risparmiate tolgono più rumore di quanta informazione di fase si perde. Su N = 15 questo avviene, ma in modo favorito, perché le fasi sono esatte in due bit; nella stima di fase isolata il vantaggio ricompare in modo consistente; su N = 21, dove l’aritmetica è profonda e le fasi richiedono precisione, non emerge. È un criterio di progetto che dipende da istanza, fase e regime di rumore, non una regola universale.",

    "aq.stadi.kicker": "Stadio per stadio · stato ridotto esatto",
    "aq.stadi.title": "QFT piena e QFT approssimata, fianco a fianco",
    "aq.stadi.intro": "Lo stesso circuito di Shor, a sinistra con la QFT inversa piena e a destra con quella troncata al grado scelto. Le sfere mostrano lo stato di ogni qubit di conteggio alla fine di ogni stadio, calcolato con la matrice densità esatta. Con il rumore si usa il preset scelto più in basso.",
    "aq.stadi.modeAria": "Senza rumore o con rumore",
    "aq.stadi.ideal": "Senza rumore",
    "aq.stadi.noisy": "Con rumore",
    "aq.stadi.fullTitle": "QFT piena",
    "aq.stadi.aqftTitle": "AQFT · k = {k}",
    "aq.stadi.kickerIdeal": "Senza rumore",
    "aq.stadi.kickerNoisy": "Con rumore · {preset}",
    "aq.stadi.chip": "Stadio {i}/{n}",
    "aq.stadi.loading": "Calcolo delle sfere stadio per stadio…",
    "aq.stadi.loadingLive": "Calcolo delle sfere per k = {k}: è una matrice densità a 12 qubit, circa un minuto…",
    "aq.stadi.ready": "Sfere pronte: {modo}.",
    "aq.stadi.error": "Sfere non disponibili: {msg}",
    "aq.stadi.busy": "Il server sta già simulando: nuovo tentativo fra poco…",
    "aq.stadi.before": "Fino alla QFT inversa i due circuiti sono identici: cambia solo la trasformata finale.",
    "aq.stadi.sameIdeal": "Senza rumore le sfere coincidono anche dopo la QFT: troncare a k = {k} non cambia lo stato.",
    "aq.stadi.compareNoisy": "Con il rumore, sui qubit che senza rumore restano puri la lunghezza media delle frecce è {full} con la QFT piena e {aqft} con l’AQFT: meno porte, meno decoerenza.",
    "aq.stadi.fullOnly": "Con k = 7 i due circuiti sono lo stesso circuito: scegli un grado più basso.",
    "aq.stadi.needCompute": "Per k = {k} le sfere non sono nel precalcolo: premi «Calcola» (circa un minuto).",
    "aq.stadi.compute": "Calcola",
    "aq.run.waiting": "Il server sta finendo un altro calcolo: il confronto parte appena è libero…",
    "aq.status.loading": "Calcolo di rotazioni, costi compilati e distribuzioni ideali per i sette gradi…",
    "aq.status.ready": "Struttura pronta: sette circuiti compilati, circuito pieno identico al canonico.",
    "aq.status.error": "Struttura AQFT non disponibile: {msg}",

    "tour.aqft.title": "Un’altra leva: togliere porte",
    "tour.aqft.text": "Prima ancora di correggere il rumore si può accorciare il circuito. La QFT approssimata toglie le rotazioni più piccole della trasformata finale.",
    "tour.aqftCircuito.title": "Rotazioni sempre più piccole",
    "tour.aqftCircuito.text": "La QFT inversa ha 28 rotazioni: fra qubit lontani l’angolo è minuscolo, ma costa sempre due CX. Scendendo da k = 7 a k = 1 ne restano 7.",
    "tour.aqftCosto.title": "21 rotazioni in meno, 42 CX in meno",
    "tour.aqftCosto.text": "Compilato come nel laboratorio: da 224 a 182 porte a due qubit. Le rz sono virtuali e non portano rumore.",
    "tour.aqftEsatta.title": "Su N = 15 non si perde nulla",
    "tour.aqftEsatta.text": "La resa ideale resta 75% per ogni k. I risultati 0, 64, 128 e 192 hanno a zero i bit b0…b5: delle 28 rotazioni agisce solo c6 → c7.",
    "tour.aqftEsegui.title": "Stesso rumore, due trasformate",
    "tour.aqftEsegui.text": "QFT piena e AQFT con k = 1 girano 1024 volte ciascuna sotto il rumore UC1, con seed indipendenti.",
    "tour.aqftRisultati.title": "Meno porte, più fattori",
    "tour.aqftRisultati.text": "Fattori trovati: {#aqKpiFull} con la QFT piena, {#aqKpiAqft} con l’AQFT. Differenza: {#aqKpiDelta}.",
    "tour.aqftCurva.title": "Più rumore, più guadagno",
    "tour.aqftCurva.text": "Su tutti i gradi: sotto UC2 il vantaggio cresce; con il solo readout è nullo, perché l’errore di misura arriva dopo il circuito.",
    "tour.aqftTesi.title": "Che cosa misura la tesi",
    "tour.aqftTesi.text": "Su una snapshot FakeSherbrooke la campagna M15 misura +14,9 punti con 83 ECR in meno. Su N = 15 il risultato è favorito; su N = 21 il vantaggio non emerge.",

    "tour.cfIntro.kicker": "Algoritmo di Shor · QFT piena e QFT approssimata",
    "tour.cfIntro.title": "Stesso algoritmo, meno porte",
    "tour.cfIntro.text": "Prima il circuito classico, senza rumore, e la sua resa. Poi la QFT approssimata: che cosa toglie, che cosa costa e come cambia il risultato con il rumore.",
    "tour.cfIstanza.title": "Il problema",
    "tour.cfIstanza.text": "Fattorizziamo N = 15 con base a = 7: 8 qubit di conteggio e un registro di lavoro.",
    "tour.cfCircuito.title": "Il circuito classico",
    "tour.cfCircuito.text": "Sovrapposizione, moltiplicazioni controllate e QFT inversa piena: 28 rotazioni controllate, nessun errore.",
    "tour.cfMisura.title": "Misura e calcolo classico",
    "tour.cfMisura.text": "Dal valore misurato, frazioni continue e MCD ricavano il periodo e i fattori: 15 = 3 × 5.",
    "tour.cfPercentuale.title": "Senza rumore: 75%",
    "tour.cfPercentuale.text": "È la probabilità che una singola misura dia i fattori con il circuito classico ideale. È il riferimento per tutto il resto.",
    "tour.cfAqft.title": "Ora la QFT approssimata",
    "tour.cfAqft.text": "Si tengono solo le rotazioni fra qubit vicini: quelle fra qubit lontani hanno angoli minuscoli, ma costano due CX ciascuna.",
    "tour.cfTronca.title": "Da 28 a 7 rotazioni",
    "tour.cfTronca.text": "Scendendo da k = 7, la QFT piena, a k = 1 le rotazioni con distanza maggiore di k si spengono una alla volta.",
    "tour.cfIdeale.title": "Senza rumore non cambia nulla",
    "tour.cfIdeale.text": "Anche con k = 1 la resa ideale resta 75%: su N = 15 delle 28 rotazioni agisce solo c6 → c7, e k = 1 la tiene.",
    "tour.cfCosto.title": "Ma il circuito è più corto",
    "tour.cfCosto.text": "Dopo la compilazione: 42 porte CX in meno, da 224 a 182. Ogni porta tolta è un’occasione di errore in meno.",
    "tour.cfEsegui.title": "Il confronto con il rumore",
    "tour.cfEsegui.text": "QFT piena e AQFT girano 1024 volte ciascuna sotto lo stesso rumore UC1, con seed indipendenti.",
    "tour.cfRisultati.title": "{#aqKpiFull} contro {#aqKpiAqft}",
    "tour.cfRisultati.text": "Fattori trovati con il rumore: {#aqKpiFull} con la QFT piena, {#aqKpiAqft} con l’AQFT. Differenza {#aqKpiDelta}. {#aqKpiVerdict}",
    "tour.cfGrafico.title": "Più massa sui picchi",
    "tour.cfGrafico.text": "Con meno porte il rumore sparge meno misure fuori dai picchi 0, 64, 128 e 192.",
    "tour.pIntro.kicker": "Algoritmo di Shor · demo",
    "tour.pIntro.title": "Dal numero ai fattori",
    "tour.pIntro.text": "Scegliamo un numero, seguiamo il circuito, lo mettiamo sotto rumore e lo alleggeriamo con la QFT approssimata.",
    "tour.pScelta.title": "Si sceglie il numero",
    "tour.pScelta.text": "15 e 21 sono pronti nel menu: per N = 21 la demo sceglie la base e prepara un circuito più grande.",
    "tour.p21.title": "N = 21",
    "tour.p21.text": "La demo sceglie la base, a = 2, e prepara un circuito più grande: 10 qubit di conteggio invece di 8.",
    "tour.pAltro.title": "Un numero qualsiasi",
    "tour.pAltro.text": "Con «Altro…» si scrive un numero qualsiasi fino a 47: per 33 la demo costruisce il suo circuito.",
    "tour.pClassico.title": "A volte il circuito non serve",
    "tour.pClassico.text": "Se basta il calcolo classico, come per 14 che è pari, la demo lo dice senza costruire il circuito.",
    "tour.p15.title": "Torniamo a N = 15",
    "tour.p15.text": "Base a = 7, 8 qubit di conteggio.",
    "tour.pPipeline.title": "Dalla misura ai fattori",
    "tour.pPipeline.text": "y/256 è la fase: la frazione continua dà il periodo r, l’MCD di 7^(r/2) ± 1 con 15 dà 3 e 5.",
    "tour.pEsegui.title": "Ora con il rumore",
    "tour.pEsegui.text": "Lo stesso circuito gira 1024 volte senza rumore e 1024 volte con il rumore UC1.",
    "tour.pRisultati.title": "Senza rumore {#idealYield}, con il rumore {#noisyYield}",
    "tour.pRisultati.text": "Con il rumore i fattori arrivano in {#noisyYield} delle misure invece di {#idealYield}.",
    "tour.pAqftEsegui.title": "QFT piena contro QFT approssimata",
    "tour.pAqftEsegui.text": "Stesso rumore UC1, 1024 misure ciascuna. Il braccio con la QFT piena è lo stesso campione del laboratorio.",
    "tour.pAqftRisultati.title": "{#aqKpiFull} → {#aqKpiAqft}",
    "tour.pAqftRisultati.text": "Stesso rumore: con la QFT approssimata i fattori arrivano in {#aqKpiAqft} delle misure invece di {#aqKpiFull}, {#aqKpiDelta}.",
    "tour.pCircuito.title": "Il circuito, passo per passo",
    "tour.pCircuito.text": "Sovrapposizione, moltiplicazioni controllate per 7 mod 15, QFT inversa: le frecce mostrano lo stato di ogni qubit.",
    "tour.pTronca.title": "Da 28 a 7 rotazioni, 42 CX in meno",
    "tour.pTronca.text": "Si tengono solo le rotazioni fra qubit vicini: quelle fra qubit lontani hanno angoli minuscoli ma costano due CX ciascuna.",
    "tour.nIntro.kicker": "Algoritmo di Shor · N = 15",
    "tour.nIntro.title": "Dal numero ai fattori",
    "tour.nIntro.text": "Fattorizziamo N = 15 con base 7: seguiamo il circuito passo per passo, lo mettiamo sotto rumore e lo alleggeriamo con la QFT approssimata.",
    "tour.nNumero.title": "Si inserisce N = 15",
    "tour.nNumero.text": "Il numero da fattorizzare si sceglie qui: scriviamo 15. La demo prepara il circuito con base a = 7 e 8 qubit di conteggio.",
    "tour.nEsegui.title": "Si esegue il circuito",
    "tour.nEsegui.text": "Hadamard, moltiplicazioni controllate per 7 mod 15, QFT inversa: le sfere mostrano lo stato dei qubit dopo ogni stadio.",
    "tour.nSignificato.title": "Che cosa vuol dire il risultato",
    "tour.nSignificato.text": "La misura y diviso 256 è una fase: la frazione continua dà il periodo r = 4, e l’MCD di 7^(r/2) ± 1 con 15 dà i fattori 3 e 5.",
    "tour.nSuccesso.title": "Tasso di successo: 75%",
    "tour.nSuccesso.text": "Senza rumore 3 misure su 4 danno i fattori; ripetendo la misura una volta si arriva al 93,75%.",
    "tour.nRumoreN.title": "Laboratorio del rumore: sempre N = 15",
    "tour.nRumoreN.text": "Stessa istanza, N = 15 con base 7: ora le porte e la lettura sbagliano come in un processore reale.",
    "tour.nRumoreConfronto.title": "Senza rumore e con il rumore, fianco a fianco",
    "tour.nRumoreConfronto.text": "A sinistra il circuito ideale, a destra lo stesso circuito con il rumore UC1: stadio dopo stadio le frecce di destra si accorciano, i qubit perdono informazione.",
    "tour.nRumoreEsegui.title": "Si esegue con il rumore",
    "tour.nRumoreEsegui.text": "Il circuito gira 1024 volte con il rumore UC1: errori sulle porte, decoerenza e lettura imperfetta.",
    "tour.nRumoreRisultati.title": "Tasso di successo con il rumore: {#noisyYield}",
    "tour.nRumoreRisultati.text": "Con il rumore i fattori arrivano in {#noisyYield} delle misure invece di {#idealYield}.",
    "tour.nAqftN.title": "Stesso N = 15, con la QFT approssimata",
    "tour.nAqftN.text": "Stessa istanza, N = 15 e a = 7: cambia solo la QFT inversa alla fine del circuito.",
    "tour.nAqftTronca.title": "Da 28 a 7 rotazioni, 42 CX in meno",
    "tour.nAqftTronca.text": "Si tengono solo le rotazioni fra qubit vicini: 42 porte CX in meno, quindi meno occasioni di errore.",
    "tour.nAqftRisultati.title": "Con l’AQFT i fattori 3 e 5 arrivano nel {#aqKpiAqft} delle misure",
    "tour.nAqftRisultati.text": "Senza rumore il successo è 75%. Con lo stesso rumore la QFT piena scende al {#aqKpiFull}, la QFT approssimata solo al {#aqKpiAqft}.",
    "tour.nFine.kicker": "Claudio Dragotta · Tesi magistrale · Università Campus Bio-Medico di Roma",
    "tour.nFine.title": "Successo: 75% senza rumore · {#noisyYield} con il rumore · {#aqKpiAqft} con l’AQFT",
    "tour.nFine.text": "Il rumore fa scendere la probabilità di ottenere 3 e 5; con la QFT approssimata, che ha 42 porte CX in meno, scende molto meno.",
    "tour.sIntro.kicker": "Algoritmo di Shor · N = 15",
    "tour.sIntro.title": "Il circuito passo per passo, con e senza rumore",
    "tour.sIntro.text": "Lo stesso circuito di Shor con la QFT inversa piena e con quella approssimata, seguito stadio per stadio.",
    "tour.sStato0.title": "Senza rumore · stato iniziale",
    "tour.sStato0.text": "A sinistra la QFT piena, a destra l’AQFT con k = 1. Tutti i qubit di conteggio partono da |0⟩.",
    "tour.sHadamard.title": "Sovrapposizione",
    "tour.sHadamard.text": "Le porte H portano i qubit di conteggio sull’equatore della sfera.",
    "tour.sMoltiplicazioni.title": "Moltiplicazioni controllate",
    "tour.sMoltiplicazioni.text": "Le moltiplicazioni per 7 mod 15 scrivono il periodo nelle fasi: le frecce si accorciano per l’entanglement, uguali nei due circuiti.",
    "tour.sQft.title": "QFT inversa: stesse sfere",
    "tour.sQft.text": "Senza rumore le sfere dopo la QFT coincidono: togliere 21 rotazioni non cambia lo stato.",
    "tour.sRumore.title": "Ora con il rumore UC1",
    "tour.sRumore.text": "Gli stessi stadi con il rumore: ogni porta aggiunge un po’ di errore e le frecce si accorciano.",
    "tour.sRumoreQft.title": "Dopo la QFT: {#aqStadiLenAqft} contro {#aqStadiLenFull}",
    "tour.sRumoreQft.text": "Sui qubit che senza rumore restano puri, le frecce dell’AQFT restano più lunghe: meno porte, meno decoerenza.",
    "tour.sFine.kicker": "Claudio Dragotta · Tesi magistrale · Università Campus Bio-Medico di Roma",
    "tour.sFine.title": "Senza rumore: stesse sfere, 75%. Con il rumore: {#aqKpiFull} → {#aqKpiAqft}.",
    "tour.sFine.text": "Su N = 15 la QFT approssimata toglie 42 porte CX senza perdere precisione: con il rumore lo stato resta più pulito e i fattori arrivano più spesso.",
    "tour.pFine.kicker": "Claudio Dragotta · Tesi magistrale · Università Campus Bio-Medico di Roma",
    "tour.pFine.title": "Senza rumore 75%. Con il rumore {#noisyYield}. Con l’AQFT {#aqKpiAqft}.",
    "tour.pFine.text": "Su N = 15 la QFT approssimata toglie 42 porte CX senza perdere precisione e recupera parte della resa persa.",
    "tour.cfFine.kicker": "Claudio Dragotta · Tesi magistrale · Università Campus Bio-Medico di Roma",
    "tour.cfFine.title": "Senza rumore 75% e 75%. Con il rumore {#aqKpiFull} → {#aqKpiAqft}.",
    "tour.cfFine.text": "Su N = 15 la QFT approssimata toglie 42 porte CX senza perdere precisione e, con il rumore, trova i fattori più spesso.",
    "tour.kIntro.kicker": "Algoritmo di Shor · demo",
    "tour.kIntro.title": "Trovare i fattori di 15 con un computer quantistico",
    "tour.kIntro.text": "Prima il circuito ideale, senza errori. Poi lo stesso calcolo con gli errori di un processore reale, confrontando il circuito completo con una versione semplificata.",
    "tour.kNumero.title": "Si sceglie il numero: 15",
    "tour.kNumero.text": "Dal menu si sceglie 15. L’obiettivo è trovare i due numeri primi che moltiplicati danno 15; la demo prepara il circuito con 8 qubit di conteggio più un registro di lavoro.",
    "tour.kCircuito.title": "Il circuito lavora, senza errori",
    "tour.kCircuito.text": "Da sinistra a destra: le porte H mettono i qubit in sovrapposizione, le moltiplicazioni nascondono un periodo, la trasformata (QFT) lo fa emergere e la misura lo legge. Le frecce a destra mostrano lo stato di ogni qubit. Risultato: 15 = 3 × 5.",
    "tour.kSuccesso.title": "Senza errori funziona 3 volte su 4: 75%",
    "tour.kSuccesso.text": "Ogni esecuzione trova 3 e 5 con probabilità del 75%; ripetendola una seconda volta si sale al 93,75%. Questo è il valore di riferimento.",
    "tour.kAqft.title": "Un circuito più leggero: la QFT approssimata",
    "tour.kAqft.text": "I processori reali sbagliano a ogni porta: più porte, più errori. Idea: semplificare la trasformata finale (QFT) togliendo le parti che contano pochissimo.",
    "tour.kTronca.title": "Da 28 a 7 rotazioni: 42 porte in meno",
    "tour.kTronca.text": "Si tolgono le rotazioni fra qubit lontani: angoli minuscoli, ma ognuna costa due porte. Si tengono solo quelle fra qubit vicini (k = 1). Senza errori il risultato resta identico: 75%.",
    "tour.kStadi.title": "Stessi errori, due circuiti a confronto",
    "tour.kStadi.text": "A sinistra il circuito completo, a destra quello semplificato (k = 1). Entrambi subiscono lo stesso rumore (UC1): quando una freccia si accorcia, il qubit sta perdendo informazione.",
    "tour.kStadiQft.title": "Il circuito semplificato perde meno informazione",
    "tour.kStadiQft.text": "Dopo la trasformata finale le frecce di destra restano più lunghe: in media {#aqStadiLenAqft} contro {#aqStadiLenFull} (1 = nessuna perdita). Meno porte, meno errori.",
    "tour.kEsegui.title": "La prova: 1024 esecuzioni ciascuno, con gli errori",
    "tour.kEsegui.text": "Si conta quante volte ciascun circuito trova davvero 3 e 5.",
    "tour.kRisultati.title": "Con gli errori: {#aqKpiFull} contro {#aqKpiAqft}",
    "tour.kRisultati.text": "Stessi errori per entrambi i circuiti. Il successo scende dal 75%: il circuito completo arriva al {#aqKpiFull}, quello semplificato al {#aqKpiAqft}. Togliere porte recupera una parte di ciò che il rumore fa perdere.",
    "tour.kFine.kicker": "Claudio Dragotta · Tesi magistrale · Università Campus Bio-Medico di Roma",
    "tour.kFine.title": "Senza errori 75% · Con errori {#aqKpiFull} · Circuito semplificato {#aqKpiAqft}",
    "tour.kFine.text": "Semplificare la trasformata finale toglie 42 porte senza perdere precisione e rende il calcolo più resistente agli errori.",
  });

  I18N.extend("en", {
    "doc.description": "Teaching demo of Shor's algorithm: ideal simulation, quantum noise lab and approximate QFT.",
    "tab.aqft.name": "Approximate QFT",
    "tab.aqft.desc": "Fewer rotations, fewer gates, less noise",

    "aq.kicker": "Approximate QFT · N = 15",
    "aq.title": "Dropping rotations to drop noise",
    "aq.intro": "The inverse QFT uses ever smaller controlled rotations: between two qubits at distance <span class=\"mono\">d</span> the angle is <span class=\"mono\">π/2ᵈ</span>, but the price is always the same, two CX gates. The <strong>AQFT</strong> keeps only the rotations with <span class=\"mono\">d ≤ k</span>: fewer gates, so fewer chances for an error, at the risk of losing phase precision. It is the truncation of the thesis campaign M15.",
    "aq.badge.instance": "Instance",
    "aq.badge.register": "Register",
    "aq.badge.rotations": "Rotations",
    "aq.k.label": "Truncation degree",
    "aq.k.aria": "Truncation degree k of the inverse QFT",
    "aq.k.full": "k = {k} · full QFT: all 28 rotations.",
    "aq.k.help": "k = {k} · rotations down to π/{den} are kept; {kept} of 28 remain.",
    "aq.tick.full": "full",

    "aq.circuit.kicker": "The circuit",
    "aq.circuit.title": "Approximate QFT on the counting register",
    "aq.circuit.intro": "The circuit that runs at the chosen degree: first the four SWAPs that reverse the bit order, then for each qubit the controlled rotations that remain, and finally a Hadamard. The removed rotations are gone: at k = 7 this is the full inverse QFT, and lowering k shortens the circuit. The yellow ring marks <strong>the only rotation that actually acts on N = 15</strong>.",
    "aq.circuit.scroller": "Inverse QFT circuit, scrolls horizontally",
    "aq.circuit.chip": "{kept}/28 rotations",
    "aq.circuit.svgTitle": "8-qubit inverse QFT with truncation degree k = {k}",
    "aq.circuit.svgDesc": "Four SWAPs, then for each qubit j the controlled rotations of angle π/2^(j−m) with j − m ≤ {k}, and a Hadamard: {kept} of 28 rotations remain, and the {removed} removed ones are not shown.",
    "aq.circuit.block": "c{j}",
    "aq.circuit.only": "the only one acting",
    "aq.legend.kept": "kept rotation",
    "aq.legend.h": "Hadamard",
    "aq.legend.swap": "bit-reversal SWAP",
    "aq.dist.head": "d = {d}",
    "aq.dist.angle": "angle π/{den}",
    "aq.dist.pairs": "{n} pairs",
    "aq.dist.cost": "{cx} CX",
    "aq.dist.kept": "kept",
    "aq.dist.removed": "removed",

    "aq.cost.kicker": "After compilation",
    "aq.cost.title": "What the whole circuit costs",
    "aq.cost.intro": "Full Shor circuit, compiled as in the noise lab (rz/sx/x/cx basis, level 2, fixed seed). The rz gates are virtual and carry no noise: what matters most is how many CX remain.",
    "aq.cost.cx": "CX (2-qubit)",
    "aq.cost.sx": "SX/X (1-qubit)",
    "aq.cost.rz": "Virtual RZ",
    "aq.cost.depth": "Depth",
    "aq.cost.full": "full",
    "aq.cost.aqft": "k = {k}",
    "aq.cost.same": "unchanged",
    "aq.cost.source": "Basis {basis} · transpiler seed {seed} · at k = 7 the compiled circuit matches the thesis canonical one (SHA-256 {sha}…){check}",
    "aq.cost.checkOk": " ✓",
    "aq.cost.checkKo": " — WARNING: SHA differs from the canonical one",

    "aq.ideal.kicker": "Without noise",
    "aq.ideal.title": "What truncation costs",
    "aq.ideal.full": "Ideal · full QFT",
    "aq.ideal.aqft": "Ideal · k = {k}",
    "aq.ideal.tvd": "Distance from full",
    "aq.ideal.yieldHelp": "exact probability of extracting the factors",
    "aq.ideal.tvdHelp": "TVD between the two exact distributions, within numerical rounding",
    "aq.ideal.zero": "0",
    "aq.phase.title": "Why nothing is lost on N = 15",
    "aq.phase.text": "With order r = 4 the phases are s/4. In each branch the register ends on one of these four values y, and in binary only the two highest bits, b7 and b6, can be 1:",
    "aq.phase.after": "Every rotation of the inverse QFT is controlled by a qubit already processed, which at that point holds exactly its bit of the result. Bits b0…b5 are always 0, so the rotations they control are the identity: <strong>of the 28 only one acts, c6 → c7</strong>, at distance 1 and kept by every k ≥ 1.",
    "aq.phase.n21": "On N = 21 the order is r = 6 and the phases j/6 cannot be written with a few bits: there the fine rotations carry information and truncating costs yield even without noise.",
    "aq.ideal.verdict": "At k = {k} the ideal distribution is identical to the full QFT one: yield {y}. {cx} CX are removed and nothing is lost.",
    "aq.ideal.verdictFull": "The full QFT is the reference: ideal yield {y}, exact peaks at 0, 64, 128 and 192.",

    "aq.run.kicker": "With noise · live simulation",
    "aq.run.title": "Full QFT versus approximate QFT",
    "aq.run.intro": "The two circuits run on Aer with <strong>the same noise model</strong> and the same number of shots, but independent seeds, so the Newcombe interval on the difference is correct. It is the lab’s <strong>uniform, illustrative</strong> model, not a QPU calibration.",
    "aq.run.btn": "Compare the two transforms",
    "aq.run.running": "Simulating: full QFT and k = {k}, {shots} shots each…",
    "aq.run.done": "Comparison completed in {s} s.",
    "aq.run.error": "Comparison failed: {msg}",
    "aq.run.busy": "Another simulation is running: try again in a few seconds.",
    "aq.run.stale": "The degree or preset changed after the last comparison: the results below refer to k = {k}, {preset}.",
    "aq.run.empty.title": "No comparison run yet",
    "aq.run.empty.text": "Pick a degree and a preset, then run: both circuits use the same noise and the same shots.",
    "aq.run.fullOnly": "With k = 7 the two circuits are identical: pick a lower degree to see the effect of truncation.",
    "aq.snapshot": "{preset}: {canali}",
    "aq.snapshot.thermalOff": "T₁/T₂ off",
    "aq.kpi.full": "Full QFT · P(factors)",
    "aq.kpi.aqft": "AQFT k = {k} · P(factors)",
    "aq.kpi.delta": "Difference AQFT − full",
    "aq.kpi.cx": "CX saved",
    "aq.kpi.peaks": "Mass on peaks",
    "aq.kpi.ci": "95% CI [{lo}; {hi}]",
    "aq.kpi.deltaCi": "Newcombe 95% [{lo}; {hi}]",
    "aq.kpi.cxHelp": "{full} → {aqft} two-qubit gates",
    "aq.kpi.peaksHelp": "full {full} · AQFT {aqft}",
    "aq.kpi.verdict.better": "The AQFT yields more: the interval excludes zero.",
    "aq.kpi.verdict.worse": "The AQFT yields less: the interval excludes zero.",
    "aq.kpi.verdict.none": "Difference not resolved with these shots: the interval contains zero.",
    "aq.series.full": "Full QFT",
    "aq.series.aqft": "AQFT k = {k}",
    "aq.chart.title": "Outcome distribution under noise",
    "aq.chart.help": "Each bar is a measured register value (0–255). Dashed lines are the theoretical peaks 0, 64, 128, 192.",
    "aq.chart.svgTitle": "Noisy distributions of the full QFT and AQFT k = {k}",
    "aq.chart.summary": "On the theoretical peaks: full QFT {full}, AQFT {aqft}. The rest of the mass is spread by noise over the other {n} values.",
    "aq.chart.bar": "{serie} · value {v}: {p} ({c} shots)",
    "aq.prov.title": "Provenance of the comparison",
    "aq.prov.instance": "Instance",
    "aq.prov.degree": "Degree",
    "aq.prov.shots": "Shots per arm",
    "aq.prov.seeds": "Aer seeds",
    "aq.prov.seedsVal": "full {full} · AQFT {aqft} (independent)",
    "aq.prov.noise": "Noise",
    "aq.prov.model": "Model",
    "aq.prov.modelVal": "uniform illustrative, virtual rz, rz/sx/x/cx basis",
    "aq.prov.method": "Difference",
    "aq.prov.methodVal": "Newcombe (Wilson) for independent samples, 95%",

    "aq.curve.kicker": "All degrees · precomputed data",
    "aq.curve.title": "Where the best degree lies",
    "aq.curve.intro": "Factor yield for every k under the three presets, with the same compiled circuits and the same illustrative model. The violet line is the ideal yield, which does not depend on k; the red one is the floor of random guessing.",
    "aq.curve.chart": "Factor yield versus degree k",
    "aq.curve.help": "{shots} shots per point, bars = 95% Wilson CI. The circled point is the degree selected above.",
    "aq.curve.axisX": "truncation degree k (7 = full QFT)",
    "aq.curve.axisY": "P(factors)",
    "aq.curve.ideal": "ideal {v}",
    "aq.curve.floor": "random {v}",
    "aq.curve.verdict": "Under {preset} the yield rises from {full} with the full QFT to {best} with k = {k}: {delta}. The gain grows with gate noise, because every removed gate removes a chance for an error; with readout only it is zero, because the measurement error comes after the circuit.",
    "aq.curve.source": "precomputed/aqft_curva.json · seed {seed} + declared rule · generated {date} · full circuit SHA {sha}…",
    "aq.curve.note": "The best degree here is read off the same data that estimate it: it is a visual hint. Selection with a disjoint holdout is the thesis one, below.",

    "aq.thesis.kicker": "From the thesis · campaign M15",
    "aq.thesis.title": "What the thesis measured",
    "aq.thesis.intro": "These numbers are not computed by the demo: they are read from the M15 artifacts (<span class=\"mono\">schema 2.0</span>, seeds and manifest recorded). The noise is an offline <strong>FakeSherbrooke</strong> snapshot with ECR gates and a fixed layout: a different model from the one above, so the values do not compare digit by digit.",
    "aq.thesis.n15.title": "Shor N = 15 on a FakeSherbrooke snapshot",
    "aq.thesis.n15.help": "8,192 shots per degree in 8 batches: the degree is chosen on the 4 selection batches and reported on the 4 disjoint holdout batches.",
    "aq.thesis.n15.svgTitle": "Holdout yield per degree k, campaign M15 N = 15",
    "aq.thesis.n15.svgDesc": "Holdout yield from k = 1 to k = 7 with the compiled ECR count of each degree.",
    "aq.thesis.n15.axisY": "holdout P(factors)",
    "aq.thesis.n15.ecr": "ECR",
    "aq.thesis.col.k": "k",
    "aq.thesis.col.ecr": "ECR",
    "aq.thesis.col.depth": "Depth",
    "aq.thesis.col.train": "Selection",
    "aq.thesis.col.holdout": "Holdout",
    "aq.thesis.selected": "chosen",
    "aq.thesis.full": "full",
    "aq.thesis.n15.verdict": "k = {k} chosen on selection. On holdout the yield rises from {full} to {sel}: <strong>{delta}</strong>, Newcombe 95% CI [{lo}; {hi}], with {ecr} fewer ECR ({ref} → {now}). The result is however <strong>favoured by construction</strong>: on N = 15 truncation costs nothing even in theory, as the ideal section above shows.",
    "aq.thesis.n15.source": "{file} · seed {seed} · calibration SHA {cal}… · canonical circuit SHA {sha}…",
    "aq.thesis.n21.title": "Shor N = 21: the discriminating test",
    "aq.thesis.n21.help": "Here the QFT also sits inside the Beauregard adders: truncating it (k_arith = 1) halves the ECR count, but the phases j/6 need the fine rotations. Holdout of 128 shots per arm, calibration noise scaled down.",
    "aq.thesis.n21.factor": "Noise factor",
    "aq.thesis.n21.full": "Full",
    "aq.thesis.n21.trunc": "Truncated",
    "aq.thesis.n21.delta": "Difference [95% CI]",
    "aq.thesis.n21.verdict": "ECR from {full} to {trunc} (−{pct}), yet in no regime does the approximation show an advantage. At noise 0.003, the only level with a signal, it is the full QFT that rises above the floor.",
    "aq.thesis.n21.source": "{n} M15 sensitivity artifacts · contrast recomputed from holdout counts with newcombe_diff_ci from qft_approssimata.py",
    "aq.thesis.qpe.title": "Isolated phase estimation (M15b)",
    "aq.thesis.qpe.help": "Without modular arithmetic the circuit costs tens of gates and survives the noise: three register sizes, three phases per size, degree chosen on selection and reported on holdout.",
    "aq.thesis.qpe.svgTitle": "Yield difference AQFT minus full QFT in the nine phase-estimation benchmarks",
    "aq.thesis.qpe.svgDesc": "95% Newcombe intervals for each combination of register size and phase.",
    "aq.thesis.qpe.axis": "difference AQFT − full",
    "aq.thesis.qpe.exact": "exact",
    "aq.thesis.qpe.verdict": "Positive estimate in {pos} of {n} comparisons, interval above zero in {ex}. The largest is {max} at n = {nmax}, where {ecr} ECR are saved.",
    "aq.thesis.qpe.source": "{file} · {shots} shots per degree, 8 batches",
    "aq.thesis.caveat": "<strong>How to read it.</strong> The AQFT pays off when the gates it saves remove more noise than the phase information it loses. On N = 15 this happens, but in a favoured way, because the phases are exact in two bits; in isolated phase estimation the advantage reappears consistently; on N = 21, where the arithmetic is deep and the phases need precision, it does not emerge. It is a design criterion that depends on instance, phase and noise regime, not a universal rule.",

    "aq.stadi.kicker": "Stage by stage · exact reduced state",
    "aq.stadi.title": "Full QFT and approximate QFT, side by side",
    "aq.stadi.intro": "The same Shor circuit, on the left with the full inverse QFT and on the right with the one truncated at the chosen degree. The spheres show the state of each counting qubit at the end of each stage, computed with the exact density matrix. Under noise, the preset chosen further down is used.",
    "aq.stadi.modeAria": "Without or with noise",
    "aq.stadi.ideal": "Without noise",
    "aq.stadi.noisy": "With noise",
    "aq.stadi.fullTitle": "Full QFT",
    "aq.stadi.aqftTitle": "AQFT · k = {k}",
    "aq.stadi.kickerIdeal": "Without noise",
    "aq.stadi.kickerNoisy": "With noise · {preset}",
    "aq.stadi.chip": "Stage {i}/{n}",
    "aq.stadi.loading": "Computing the spheres stage by stage…",
    "aq.stadi.loadingLive": "Computing the spheres for k = {k}: a 12-qubit density matrix, about a minute…",
    "aq.stadi.ready": "Spheres ready: {modo}.",
    "aq.stadi.error": "Spheres unavailable: {msg}",
    "aq.stadi.busy": "The server is already simulating: retrying shortly…",
    "aq.stadi.before": "Up to the inverse QFT the two circuits are identical: only the final transform changes.",
    "aq.stadi.sameIdeal": "Without noise the spheres coincide even after the QFT: truncating at k = {k} does not change the state.",
    "aq.stadi.compareNoisy": "Under noise, on the qubits that stay pure without noise the mean arrow length is {full} with the full QFT and {aqft} with the AQFT: fewer gates, less decoherence.",
    "aq.stadi.fullOnly": "With k = 7 the two circuits are the same circuit: pick a lower degree.",
    "aq.stadi.needCompute": "For k = {k} the spheres are not in the precomputed data: press “Compute” (about a minute).",
    "aq.stadi.compute": "Compute",
    "aq.run.waiting": "The server is finishing another computation: the comparison starts as soon as it is free…",
    "aq.status.loading": "Computing rotations, compiled costs and ideal distributions for the seven degrees…",
    "aq.status.ready": "Structure ready: seven compiled circuits, full circuit identical to the canonical one.",
    "aq.status.error": "AQFT structure unavailable: {msg}",

    "tour.aqft.title": "Another lever: removing gates",
    "tour.aqft.text": "Even before correcting noise, the circuit can be shortened. The approximate QFT drops the smallest rotations of the final transform.",
    "tour.aqftCircuito.title": "Ever smaller rotations",
    "tour.aqftCircuito.text": "The inverse QFT has 28 rotations: between distant qubits the angle is tiny, yet it always costs two CX. Going from k = 7 down to k = 1 leaves 7.",
    "tour.aqftCosto.title": "21 fewer rotations, 42 fewer CX",
    "tour.aqftCosto.text": "Compiled as in the noise lab: from 224 to 182 two-qubit gates. The rz gates are virtual and carry no noise.",
    "tour.aqftEsatta.title": "On N = 15 nothing is lost",
    "tour.aqftEsatta.text": "The ideal yield stays at 75% for every k. The outcomes 0, 64, 128 and 192 have bits b0…b5 at zero: of the 28 rotations only c6 → c7 acts.",
    "tour.aqftEsegui.title": "Same noise, two transforms",
    "tour.aqftEsegui.text": "Full QFT and AQFT with k = 1 run 1024 times each under UC1 noise, with independent seeds.",
    "tour.aqftRisultati.title": "Fewer gates, more factors",
    "tour.aqftRisultati.text": "Factors found: {#aqKpiFull} with the full QFT, {#aqKpiAqft} with the AQFT. Difference: {#aqKpiDelta}.",
    "tour.aqftCurva.title": "More noise, more gain",
    "tour.aqftCurva.text": "Across all degrees: under UC2 the advantage grows; with readout only it is zero, because the measurement error comes after the circuit.",
    "tour.aqftTesi.title": "What the thesis measures",
    "tour.aqftTesi.text": "On a FakeSherbrooke snapshot the M15 campaign measures +14.9 points with 83 fewer ECR. On N = 15 the result is favoured; on N = 21 the advantage does not emerge.",

    "tour.cfIntro.kicker": "Shor's algorithm · full QFT and approximate QFT",
    "tour.cfIntro.title": "Same algorithm, fewer gates",
    "tour.cfIntro.text": "First the classic circuit, without noise, and its yield. Then the approximate QFT: what it removes, what it costs and how the result changes under noise.",
    "tour.cfIstanza.title": "The problem",
    "tour.cfIstanza.text": "We factor N = 15 with base a = 7: 8 counting qubits and a work register.",
    "tour.cfCircuito.title": "The classic circuit",
    "tour.cfCircuito.text": "Superposition, controlled multiplications and the full inverse QFT: 28 controlled rotations, no errors.",
    "tour.cfMisura.title": "Measurement and classical step",
    "tour.cfMisura.text": "From the measured value, continued fractions and GCD recover the period and the factors: 15 = 3 × 5.",
    "tour.cfPercentuale.title": "Without noise: 75%",
    "tour.cfPercentuale.text": "This is the probability that a single measurement yields the factors with the ideal classic circuit. It is the reference for everything else.",
    "tour.cfAqft.title": "Now the approximate QFT",
    "tour.cfAqft.text": "Only the rotations between nearby qubits are kept: those between distant qubits have tiny angles, yet cost two CX each.",
    "tour.cfTronca.title": "From 28 to 7 rotations",
    "tour.cfTronca.text": "Going from k = 7, the full QFT, down to k = 1, the rotations with distance greater than k switch off one at a time.",
    "tour.cfIdeale.title": "Without noise nothing changes",
    "tour.cfIdeale.text": "Even with k = 1 the ideal yield stays at 75%: on N = 15 only c6 → c7 of the 28 rotations acts, and k = 1 keeps it.",
    "tour.cfCosto.title": "But the circuit is shorter",
    "tour.cfCosto.text": "After compilation: 42 fewer CX gates, from 224 to 182. Every removed gate is one less chance for an error.",
    "tour.cfEsegui.title": "The comparison under noise",
    "tour.cfEsegui.text": "Full QFT and AQFT run 1024 times each under the same UC1 noise, with independent seeds.",
    "tour.cfRisultati.title": "{#aqKpiFull} versus {#aqKpiAqft}",
    "tour.cfRisultati.text": "Factors found under noise: {#aqKpiFull} with the full QFT, {#aqKpiAqft} with the AQFT. Difference {#aqKpiDelta}. {#aqKpiVerdict}",
    "tour.cfGrafico.title": "More mass on the peaks",
    "tour.cfGrafico.text": "With fewer gates, noise spreads fewer measurements away from the peaks 0, 64, 128 and 192.",
    "tour.pIntro.kicker": "Shor's algorithm · demo",
    "tour.pIntro.title": "From the number to its factors",
    "tour.pIntro.text": "We pick a number, follow the circuit, put it under noise and lighten it with the approximate QFT.",
    "tour.pScelta.title": "Choosing the number",
    "tour.pScelta.text": "15 and 21 are ready in the menu: for N = 21 the demo picks the base and prepares a larger circuit.",
    "tour.p21.title": "N = 21",
    "tour.p21.text": "The demo picks the base, a = 2, and prepares a larger circuit: 10 counting qubits instead of 8.",
    "tour.pAltro.title": "Any number",
    "tour.pAltro.text": "With “Other…” any number up to 47 can be typed: for 33 the demo builds its circuit.",
    "tour.pClassico.title": "Sometimes no circuit is needed",
    "tour.pClassico.text": "When classical computation is enough, as for 14 which is even, the demo says so without building the circuit.",
    "tour.p15.title": "Back to N = 15",
    "tour.p15.text": "Base a = 7, 8 counting qubits.",
    "tour.pPipeline.title": "From the measurement to the factors",
    "tour.pPipeline.text": "y/256 is the phase: continued fractions give the period r, the GCD of 7^(r/2) ± 1 with 15 gives 3 and 5.",
    "tour.pEsegui.title": "Now with noise",
    "tour.pEsegui.text": "The same circuit runs 1024 times without noise and 1024 times under UC1 noise.",
    "tour.pRisultati.title": "Without noise {#idealYield}, with noise {#noisyYield}",
    "tour.pRisultati.text": "Under noise the factors come in {#noisyYield} of the measurements instead of {#idealYield}.",
    "tour.pAqftEsegui.title": "Full QFT versus approximate QFT",
    "tour.pAqftEsegui.text": "Same UC1 noise, 1024 measurements each. The full-QFT arm is the same sample as in the noise lab.",
    "tour.pAqftRisultati.title": "{#aqKpiFull} → {#aqKpiAqft}",
    "tour.pAqftRisultati.text": "Same noise: with the approximate QFT the factors come in {#aqKpiAqft} of the measurements instead of {#aqKpiFull}, {#aqKpiDelta}.",
    "tour.pCircuito.title": "The circuit, step by step",
    "tour.pCircuito.text": "Superposition, controlled multiplications by 7 mod 15, inverse QFT: the arrows show the state of each qubit.",
    "tour.pTronca.title": "From 28 to 7 rotations, 42 fewer CX",
    "tour.pTronca.text": "Only rotations between nearby qubits are kept: those between distant qubits have tiny angles yet cost two CX each.",
    "tour.nIntro.kicker": "Shor's algorithm · N = 15",
    "tour.nIntro.title": "From the number to its factors",
    "tour.nIntro.text": "We factor N = 15 with base 7: we follow the circuit step by step, put it under noise and lighten it with the approximate QFT.",
    "tour.nNumero.title": "Entering N = 15",
    "tour.nNumero.text": "The number to factor is chosen here: we type 15. The demo prepares the circuit with base a = 7 and 8 counting qubits.",
    "tour.nEsegui.title": "Running the circuit",
    "tour.nEsegui.text": "Hadamard, controlled multiplications by 7 mod 15, inverse QFT: the spheres show the qubit state after each stage.",
    "tour.nSignificato.title": "What the result means",
    "tour.nSignificato.text": "The measurement y divided by 256 is a phase: continued fractions give the period r = 4, and the GCD of 7^(r/2) ± 1 with 15 gives the factors 3 and 5.",
    "tour.nSuccesso.title": "Success rate: 75%",
    "tour.nSuccesso.text": "Without noise 3 measurements out of 4 give the factors; measuring once more reaches 93.75%.",
    "tour.nRumoreN.title": "Noise lab: still N = 15",
    "tour.nRumoreN.text": "Same instance, N = 15 with base 7: now gates and readout make errors as on a real processor.",
    "tour.nRumoreConfronto.title": "Without and with noise, side by side",
    "tour.nRumoreConfronto.text": "On the left the ideal circuit, on the right the same circuit under UC1 noise: stage after stage the arrows on the right shrink, the qubits lose information.",
    "tour.nRumoreEsegui.title": "Running with noise",
    "tour.nRumoreEsegui.text": "The circuit runs 1024 times under UC1 noise: gate errors, decoherence and imperfect readout.",
    "tour.nRumoreRisultati.title": "Success rate with noise: {#noisyYield}",
    "tour.nRumoreRisultati.text": "Under noise the factors come in {#noisyYield} of the measurements instead of {#idealYield}.",
    "tour.nAqftN.title": "Same N = 15, with the approximate QFT",
    "tour.nAqftN.text": "Same instance, N = 15 and a = 7: only the inverse QFT at the end of the circuit changes.",
    "tour.nAqftTronca.title": "From 28 to 7 rotations, 42 fewer CX",
    "tour.nAqftTronca.text": "Only rotations between nearby qubits are kept: 42 fewer CX gates, so fewer chances for errors.",
    "tour.nAqftRisultati.title": "With the AQFT the factors 3 and 5 come in {#aqKpiAqft} of the measurements",
    "tour.nAqftRisultati.text": "Without noise the success rate is 75%. Under the same noise the full QFT drops to {#aqKpiFull}, the approximate QFT only to {#aqKpiAqft}.",
    "tour.nFine.kicker": "Claudio Dragotta · Master's thesis · Università Campus Bio-Medico di Roma",
    "tour.nFine.title": "Success: 75% without noise · {#noisyYield} with noise · {#aqKpiAqft} with the AQFT",
    "tour.nFine.text": "Noise lowers the probability of getting 3 and 5; with the approximate QFT, which has 42 fewer CX gates, it drops much less.",
    "tour.sIntro.kicker": "Shor's algorithm · N = 15",
    "tour.sIntro.title": "The circuit step by step, with and without noise",
    "tour.sIntro.text": "The same Shor circuit with the full inverse QFT and with the approximate one, followed stage by stage.",
    "tour.sStato0.title": "Without noise · initial state",
    "tour.sStato0.text": "On the left the full QFT, on the right the AQFT with k = 1. All counting qubits start from |0⟩.",
    "tour.sHadamard.title": "Superposition",
    "tour.sHadamard.text": "The H gates bring the counting qubits onto the equator of the sphere.",
    "tour.sMoltiplicazioni.title": "Controlled multiplications",
    "tour.sMoltiplicazioni.text": "Multiplications by 7 mod 15 write the period into the phases: the arrows shrink through entanglement, the same in both circuits.",
    "tour.sQft.title": "Inverse QFT: same spheres",
    "tour.sQft.text": "Without noise the spheres after the QFT coincide: removing 21 rotations does not change the state.",
    "tour.sRumore.title": "Now with UC1 noise",
    "tour.sRumore.text": "The same stages under noise: every gate adds some error and the arrows shrink.",
    "tour.sRumoreQft.title": "After the QFT: {#aqStadiLenAqft} versus {#aqStadiLenFull}",
    "tour.sRumoreQft.text": "On the qubits that stay pure without noise, the AQFT arrows stay longer: fewer gates, less decoherence.",
    "tour.sFine.kicker": "Claudio Dragotta · Master's thesis · Università Campus Bio-Medico di Roma",
    "tour.sFine.title": "Without noise: same spheres, 75%. With noise: {#aqKpiFull} → {#aqKpiAqft}.",
    "tour.sFine.text": "On N = 15 the approximate QFT removes 42 CX gates without losing precision: under noise the state stays cleaner and the factors come more often.",
    "tour.pFine.kicker": "Claudio Dragotta · Master's thesis · Università Campus Bio-Medico di Roma",
    "tour.pFine.title": "Without noise 75%. With noise {#noisyYield}. With the AQFT {#aqKpiAqft}.",
    "tour.pFine.text": "On N = 15 the approximate QFT removes 42 CX gates without losing precision and recovers part of the lost yield.",
    "tour.cfFine.kicker": "Claudio Dragotta · Master's thesis · Università Campus Bio-Medico di Roma",
    "tour.cfFine.title": "Without noise 75% and 75%. With noise {#aqKpiFull} → {#aqKpiAqft}.",
    "tour.cfFine.text": "On N = 15 the approximate QFT removes 42 CX gates without losing precision and, under noise, finds the factors more often.",
  });

  const t = (key, values = null) => I18N.t(key, values);
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const N_COUNT = 8;
  const K_FULL = 7;
  const PEAKS = [0, 64, 128, 192];
  const PRESET_ORDER = ["readout", "uc1", "uc2"];
  // Gli stessi valori dei preset del laboratorio (app.js) e di precalcola_aqft.py.
  const PRESETS = {
    // Come il preset del laboratorio: con "Solo readout" app.js spegne anche T1/T2.
    readout: { eps_1q: 0, eps_2q: 0, t1_us: null, t2_us: null, readout_0to1: 0.02, readout_1to0: 0.02, coherent_overrotation_deg: 0 },
    uc1: { eps_1q: 0.001, eps_2q: 0.01, t1_us: 100, t2_us: 80, readout_0to1: 0.02, readout_1to0: 0.02, coherent_overrotation_deg: 0 },
    uc2: { eps_1q: 0.005, eps_2q: 0.05, t1_us: 50, t2_us: 30, readout_0to1: 0.05, readout_1to0: 0.05, coherent_overrotation_deg: 0 },
  };
  const PRESET_COLORS = { readout: "var(--cyan)", uc1: "var(--amber)", uc2: "var(--pink)" };

  const state = {
    structure: null, k: 1, preset: "uc1",
    result: null, resultK: null, resultPreset: null, running: false,
    curve: null, tesi: null,
  };
  const statuses = new Map();

  // ------------------------------------------------------------------ utilità
  const fmt = (v, d = 2) => I18N.formatNumber(v, d);
  const pct = (v, d = 1) => (Number.isFinite(Number(v)) ? `${fmt(Number(v) * 100, d)}%` : "—");
  const pp = (v, d = 1) => {
    const n = Number(v) * 100;
    if (!Number.isFinite(n)) return "—";
    return `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n), d)} pp`;
  };
  const presetLabel = (name) => t(`preset.${name}`);
  const rotationLabel = (d) => `π/${2 ** d}`;

  function svgNode(tag, attrs = {}, text = null) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    if (text != null) el.textContent = String(text);
    return el;
  }

  function clearSvg(svg, title, desc) {
    const ids = (svg.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    svg.replaceChildren(
      svgNode("title", ids[0] ? { id: ids[0] } : {}, title),
      svgNode("desc", ids[1] ? { id: ids[1] } : {}, desc),
    );
  }

  function el(tag, className = "", text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function setStatus(id, key, values = null, kind = "") {
    statuses.set(id, { key, values, kind });
    renderStatus(id);
  }

  function renderStatus(id) {
    const s = statuses.get(id);
    const node = $(id);
    if (!s || !node) return;
    const values = s.values && Object.fromEntries(Object.entries(s.values)
      .map(([k, v]) => [k, typeof v === "function" ? v() : v]));
    node.textContent = s.key ? t(s.key, values) : "";
    node.className = `status-line${s.kind ? ` is-${s.kind}` : ""}`;
  }

  async function apiJSON(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join("; ") : data.detail;
      const error = new Error(detail || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const degree = (k) => state.structure?.degrees.find((g) => g.k === k) || null;

  // ------------------------------------------------------------------ grado
  function renderDegree() {
    const k = state.k;
    const g = degree(k);
    const kept = g ? g.rotations_kept : [0, 7, 13, 18, 22, 25, 27, 28][k];
    $("aqKValue").textContent = `k = ${k}`;
    $("aqKHelp").textContent = k === K_FULL ? t("aq.k.full", { k })
      : t("aq.k.help", { k, den: 2 ** k, kept });
    $("aqBadgeRot").textContent = `${kept}/28`;
    $("aqCircuitChip").textContent = t("aq.circuit.chip", { kept });
    const ticks = $("aqTicks");
    ticks.replaceChildren();
    for (let i = 1; i <= K_FULL; i += 1) {
      const span = el("span", i === k ? "is-active" : "", i === K_FULL ? `7 · ${t("aq.tick.full")}` : String(i));
      span.style.left = `${((i - 1) / (K_FULL - 1)) * 100}%`;
      ticks.append(span);
    }
  }

  // ------------------------------------------------------------------ circuito
  /* QFT inversa textbook su n qubit: n/2 SWAP di inversione, poi per ogni qubit j
     le rotazioni controllate dai qubit m < j (distanza d = j - m, angolo π/2^d)
     seguite dalla H su j. Una colonna per operazione.

     Serve a due schede. Il simulatore ideale la disegna piena, per qualunque
     registro (8, 10 o 12 qubit); la scheda 03 la disegna troncata al grado k e,
     con soloTenute, lascia fuori le rotazioni tolte: il circuito che si vede e'
     quello che gira, e si accorcia davvero. */
  function disegnaQftInversa(svg, { n = N_COUNT, k = n - 1, soloTenute = false, anello = false,
                                    titolo = "", descrizione = "" } = {}) {
    const left = 64, right = 18, top = 46;
    const rowGap = 41;
    const yq = (q) => top + q * rowGap;
    const tenuta = (d) => d <= k;
    const ops = [];
    for (let s = 0; s < Math.floor(n / 2); s += 1) ops.push({ kind: "swap", a: s, b: n - 1 - s });
    for (let j = 0; j < n; j += 1) {
      for (let m = 0; m < j; m += 1) {
        const d = j - m;
        if (!soloTenute || tenuta(d)) ops.push({ kind: "cp", m, j, d });
      }
      ops.push({ kind: "h", j });
    }
    // Sotto i 24 px per colonna le etichette non stanno: il disegno si allarga e
    // lo scroller orizzontale lo contiene.
    const W = Math.max(1180, left + right + 16 + ops.length * 24);
    const H = top + rowGap * (n - 1) + 54;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    // .aq-circuit-svg tiene 1080 px per 1180 unita': un registro piu' grande alza
    // la soglia nella stessa proporzione, altrimenti il disegno verrebbe compresso
    // nella larghezza della pagina invece di scorrere.
    svg.style.minWidth = W > 1180 ? `${Math.round((1080 * W) / 1180)}px` : "";
    const colW = (W - left - right - 16) / ops.length;
    const xc = (i) => left + 10 + colW * (i + .5);
    clearSvg(svg, titolo, descrizione);

    // Fasce dei blocchi: tutto cio' che termina con la H su c_j.
    let start = Math.floor(n / 2);
    for (let j = 0; j < n; j += 1) {
      const len = 1 + ops.filter((op) => op.kind === "cp" && op.j === j).length;
      const x0 = xc(start) - colW / 2, x1 = xc(start + len - 1) + colW / 2;
      if (j % 2 === 1) {
        svg.append(svgNode("rect", { x: x0, y: top - 30, width: x1 - x0, height: rowGap * (n - 1) + 52,
          class: "aq-block", rx: 6 }));
      }
      svg.append(svgNode("text", { x: (x0 + x1) / 2, y: top - 18, class: "aq-block-label", "text-anchor": "middle" },
        t("aq.circuit.block", { j })));
      start += len;
    }

    for (let q = 0; q < n; q += 1) {
      svg.append(svgNode("line", { x1: left, y1: yq(q), x2: W - right, y2: yq(q), class: "c-wire" }));
      svg.append(svgNode("text", { x: left - 14, y: yq(q) + 4, class: "c-label", "text-anchor": "end" }, `c${q}`));
    }

    ops.forEach((op, i) => {
      const x = xc(i);
      if (op.kind === "swap") {
        const g = svgNode("g", { class: "aq-swap" });
        g.append(svgNode("line", { x1: x, y1: yq(op.a), x2: x, y2: yq(op.b) }));
        [op.a, op.b].forEach((q) => {
          g.append(svgNode("path", { d: `M${x - 5} ${yq(q) - 5} L${x + 5} ${yq(q) + 5} M${x + 5} ${yq(q) - 5} L${x - 5} ${yq(q) + 5}` }));
        });
        svg.append(g);
        return;
      }
      if (op.kind === "h") {
        const g = svgNode("g", { class: "aq-h" });
        g.append(svgNode("rect", { x: x - 10, y: yq(op.j) - 10, width: 20, height: 20, rx: 4 }));
        g.append(svgNode("text", { x, y: yq(op.j) + 4, "text-anchor": "middle" }, "H"));
        svg.append(g);
        return;
      }
      const kept = tenuta(op.d);
      const g = svgNode("g", { class: `aq-cp ${kept ? "is-kept" : "is-removed"} d${op.d}` });
      const y1 = yq(op.m), y2 = yq(op.j);
      g.append(svgNode("line", { x1: x, y1, x2: x, y2: y2 - 9, class: "aq-cp-line" }));
      g.append(svgNode("circle", { cx: x, cy: y1, r: 3.6, class: "aq-cp-dot" }));
      const bw = Math.min(colW - 2, 27);
      g.append(svgNode("rect", { x: x - bw / 2, y: y2 - 9, width: bw, height: 18, rx: 3.5, class: "aq-cp-box" }));
      g.append(svgNode("text", { x, y: y2 + 3, "text-anchor": "middle", class: "aq-cp-text" },
        op.d <= 4 ? rotationLabel(op.d) : `/${2 ** op.d}`));
      if (!kept) {
        g.append(svgNode("line", { x1: x - bw / 2 - 2, y1: y2 + 11, x2: x + bw / 2 + 2, y2: y2 - 11, class: "aq-cp-strike" }));
      }
      g.append(svgNode("title", {}, `c${op.m} → c${op.j} · d = ${op.d} · ${rotationLabel(op.d)}`
        + (soloTenute || k < n - 1 ? ` · ${t(kept ? "aq.dist.kept" : "aq.dist.removed")}` : "")));
      svg.append(g);
      // Su N=15 agisce soltanto c6 → c7: gli altri qubit di conteggio arrivano
      // alla QFT inversa in uno stato di base, e le rotazioni da loro controllate
      // non fanno nulla.
      if (anello && op.m === 6 && op.j === 7) {
        svg.append(svgNode("rect", { x: x - bw / 2 - 5, y: y1 - 10, width: bw + 10, height: y2 - y1 + 24, rx: 9, class: "aq-only-ring" }));
        svg.append(svgNode("text", { x: x - bw / 2 - 9, y: y2 + 29, "text-anchor": "end", class: "aq-only-label" }, t("aq.circuit.only")));
      }
    });
  }

  function renderCircuit() {
    const k = state.k;
    const kept = Array.from({ length: K_FULL }, (_, i) => i + 1)
      .reduce((acc, d) => acc + (d <= k ? N_COUNT - d : 0), 0);
    disegnaQftInversa($("aqCircuitSvg"), {
      n: N_COUNT, k, soloTenute: true, anello: true,
      titolo: t("aq.circuit.svgTitle", { k }),
      descrizione: t("aq.circuit.svgDesc", { k, kept, removed: 28 - kept }),
    });
  }

  function renderDistance() {
    const host = $("aqDistance");
    host.replaceChildren();
    for (let d = 1; d <= K_FULL; d += 1) {
      const kept = d <= state.k;
      const cell = el("div", `aq-dist ${kept ? "is-kept" : "is-removed"}`);
      cell.append(el("b", "", t("aq.dist.head", { d })));
      cell.append(el("span", "", t("aq.dist.angle", { den: 2 ** d })));
      cell.append(el("span", "", t("aq.dist.pairs", { n: N_COUNT - d })));
      cell.append(el("span", "", t("aq.dist.cost", { cx: 2 * (N_COUNT - d) })));
      cell.append(el("small", "", t(kept ? "aq.dist.kept" : "aq.dist.removed")));
      host.append(cell);
    }
  }

  // ------------------------------------------------------------------ costo
  function renderCost() {
    const host = $("aqCost");
    host.replaceChildren();
    if (!state.structure) return;
    const full = degree(K_FULL).compiled;
    const cur = degree(state.k).compiled;
    const rows = [["cx", "aq.cost.cx"], ["sx_x", "aq.cost.sx"], ["rz", "aq.cost.rz"], ["depth", "aq.cost.depth"]];
    rows.forEach(([key, label]) => {
      const max = Math.max(full[key], cur[key], 1);
      const row = el("div", `aq-cost-row${key === "cx" ? " is-main" : ""}`);
      row.append(el("span", "aq-cost-label", t(label)));
      const bars = el("div", "aq-cost-bars");
      [["is-full", full[key], t("aq.cost.full")], ["is-aqft", cur[key], t("aq.cost.aqft", { k: state.k })]]
        .forEach(([cls, value, name]) => {
          const line = el("div", `aq-cost-bar ${cls}`);
          const track = el("span", "aq-cost-track");
          const fill = el("i");
          fill.style.width = `${(value / max) * 100}%`;
          track.append(fill);
          line.append(el("small", "", name), track, el("b", "mono", fmt(value, 0)));
          bars.append(line);
        });
      row.append(bars);
      const delta = cur[key] - full[key];
      row.append(el("span", `aq-cost-delta mono${delta < 0 ? " is-down" : ""}`,
        delta === 0 ? t("aq.cost.same") : `${delta < 0 ? "−" : "+"}${fmt(Math.abs(delta), 0)}`));
      host.append(row);
    });
    const check = state.structure.full_circuit_check || {};
    $("aqCostSource").textContent = t("aq.cost.source", {
      basis: state.structure.basis_gates.join("/"), seed: state.structure.seed_transpiler,
      sha: String(check.sha256 || "").slice(0, 12),
      check: t(check.canonico_tesi ? "aq.cost.checkOk" : "aq.cost.checkKo"),
    });
  }

  // ------------------------------------------------------------------ ideale
  function renderIdeal() {
    const kpis = $("aqIdealKpis");
    kpis.replaceChildren();
    if (!state.structure) return;
    const full = degree(K_FULL), cur = degree(state.k);
    const tvd = cur.ideal.tvd_vs_full;
    [[t("aq.ideal.full"), pct(full.ideal.factor_yield, 2), t("aq.ideal.yieldHelp"), "kpi-ideal"],
     [t("aq.ideal.aqft", { k: state.k }), pct(cur.ideal.factor_yield, 2), t("aq.ideal.yieldHelp"), "kpi-aqft"],
     [t("aq.ideal.tvd"), tvd < 1e-12 ? t("aq.ideal.zero") : tvd.toExponential(2), t("aq.ideal.tvdHelp"), ""]]
      .forEach(([label, value, help, cls]) => {
        const card = el("article", `kpi ${cls}`);
        card.append(el("small", "", label), el("strong", "", value), el("p", "", help));
        kpis.append(card);
      });

    const phase = $("aqPhase");
    phase.replaceChildren();
    phase.append(el("h3", "", t("aq.phase.title")), el("p", "", t("aq.phase.text")));
    const grid = el("div", "aq-bits");
    [[0, "0"], [64, "1/4"], [128, "1/2"], [192, "3/4"]].forEach(([v, frac]) => {
      const row = el("div", "aq-bits-row");
      row.append(el("span", "aq-bits-phase mono", `s/4 = ${frac}`), el("span", "aq-bits-val mono", `y = ${v}`));
      const bits = el("span", "aq-bits-cells");
      for (let q = N_COUNT - 1; q >= 0; q -= 1) {
        const bit = (v >> q) & 1;
        const cell = el("i", `${bit ? "is-one" : ""}${q >= 6 ? " is-high" : ""}`, String(bit));
        cell.title = `bit ${q} = ${bit}`;
        bits.append(cell);
      }
      row.append(bits);
      grid.append(row);
    });
    const head = el("div", "aq-bits-row aq-bits-head");
    head.append(el("span"), el("span"));
    const labels = el("span", "aq-bits-cells");
    for (let q = N_COUNT - 1; q >= 0; q -= 1) labels.append(el("i", "is-label", `b${q}`));
    head.append(labels);
    grid.prepend(head);
    phase.append(grid);
    const after = el("p");
    after.innerHTML = t("aq.phase.after");
    phase.append(after, el("p", "aq-phase-n21", t("aq.phase.n21")));

    const verdict = $("aqIdealVerdict");
    verdict.textContent = state.k === K_FULL
      ? t("aq.ideal.verdictFull", { y: pct(full.ideal.factor_yield, 2) })
      : t("aq.ideal.verdict", { k: state.k, y: pct(cur.ideal.factor_yield, 2), cx: full.compiled.cx - cur.compiled.cx });
  }

  // ------------------------------------------------------------------ esperimento
  function renderPresets() {
    document.querySelectorAll("[data-aq-preset]").forEach((button) => {
      const active = button.dataset.aqPreset === state.preset;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const n = PRESETS[state.preset];
    const canali = [
      `ε₁Q ${pct(n.eps_1q, 2)}`, `ε₂Q ${pct(n.eps_2q, 2)}`,
      n.t1_us == null ? t("aq.snapshot.thermalOff") : `T₁ ${fmt(n.t1_us, 0)} µs · T₂ ${fmt(n.t2_us, 0)} µs`,
      `readout ${pct(n.readout_0to1, 1)}`,
    ].join(" · ");
    $("aqNoiseSnapshot").textContent = t("aq.snapshot", { preset: presetLabel(state.preset), canali });
    $("aqFloor").textContent = state.structure ? pct(state.structure.random_factor_floor, 1) : "—";
    $("aqRunBtn").disabled = state.running || state.k === K_FULL;
    if (state.k === K_FULL && !state.running) setStatus("aqRunStatus", "aq.run.fullOnly");
    else if (statuses.get("aqRunStatus")?.key === "aq.run.fullOnly") setStatus("aqRunStatus", "");
  }

  async function runExperiment() {
    if (state.running || state.k === K_FULL) return;
    const shots = Number($("aqShots").value);
    let seed = Number($("aqSeed").value);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) seed = 42;
    const k = state.k, preset = state.preset;
    state.running = true;
    renderPresets();
    setStatus("aqRunStatus", "aq.run.running", { k, shots: () => fmt(shots, 0) }, "loading");
    const t0 = performance.now();
    try {
      // Il server simula una cosa per volta: se e' occupato (sfere, laboratorio) si riprova.
      let data = null;
      for (let tentativo = 0; ; tentativo += 1) {
        try {
          data = await apiJSON("/api/aqft/experiment", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ k, shots, seed, noise: PRESETS[preset] }),
          });
          break;
        } catch (error) {
          if (error.status !== 429 || tentativo >= 40) throw error;
          setStatus("aqRunStatus", "aq.run.waiting", null, "loading");
          await new Promise((r) => window.setTimeout(r, 2500));
        }
      }
      state.result = data;
      state.resultK = k;
      state.resultPreset = preset;
      setStatus("aqRunStatus", "aq.run.done", { s: () => fmt((performance.now() - t0) / 1000, 1) }, "success");
      renderResult();
    } catch (error) {
      if (error.status === 429) setStatus("aqRunStatus", "aq.run.busy", null, "error");
      else setStatus("aqRunStatus", "aq.run.error", { msg: error.message }, "error");
    } finally {
      state.running = false;
      renderPresets();
    }
  }

  function renderResult() {
    const r = state.result;
    $("aqEmpty").hidden = Boolean(r);
    $("aqResults").hidden = !r;
    if (!r) return;
    const k = r.config.k;
    $("aqSeriesAqft").textContent = t("aq.series.aqft", { k });
    const c = r.comparison;
    const kpis = $("aqKpis");
    kpis.replaceChildren();
    const card = (cls, label, value, help, valueCls = "", id = "") => {
      const node = el("article", `kpi ${cls}`);
      const strong = el("strong", valueCls, value);
      if (id) strong.id = id;
      node.append(el("small", "", label), strong, el("p", "", help));
      kpis.append(node);
      return node;
    };
    card("kpi-ideal", t("aq.kpi.full"), pct(r.full.factor_yield, 1),
      t("aq.kpi.ci", { lo: pct(r.full.wilson_ci.low, 1), hi: pct(r.full.wilson_ci.high, 1) }), "", "aqKpiFull");
    card("kpi-aqft", t("aq.kpi.aqft", { k }), pct(r.aqft.factor_yield, 1),
      t("aq.kpi.ci", { lo: pct(r.aqft.wilson_ci.low, 1), hi: pct(r.aqft.wilson_ci.high, 1) }), "", "aqKpiAqft");
    const resolved = c.low > 0 ? "better" : c.high < 0 ? "worse" : "none";
    const deltaCard = card("", t("aq.kpi.delta"), pp(c.difference, 1),
      t("aq.kpi.deltaCi", { lo: pp(c.low, 1), hi: pp(c.high, 1) }),
      resolved === "better" ? "is-positive" : resolved === "worse" ? "is-negative" : "", "aqKpiDelta");
    const verdetto = el("p", "aq-kpi-verdict", t(`aq.kpi.verdict.${resolved}`));
    verdetto.id = "aqKpiVerdict";
    deltaCard.append(verdetto);
    card("", t("aq.kpi.cx"), fmt(r.full.compiled.cx - r.aqft.compiled.cx, 0),
      t("aq.kpi.cxHelp", { full: r.full.compiled.cx, aqft: r.aqft.compiled.cx }));
    card("", t("aq.kpi.peaks"), pct(r.aqft.peak_mass, 1),
      t("aq.kpi.peaksHelp", { full: pct(r.full.peak_mass, 1), aqft: pct(r.aqft.peak_mass, 1) }));

    renderDistChart(r);

    const prov = $("aqProvList");
    prov.replaceChildren();
    const n = r.config.noise;
    [[t("aq.prov.instance"), `N=${r.config.N}, a=${r.config.a}, n_count=${r.config.n_count}`],
     [t("aq.prov.degree"), `k = ${k} (${t("aq.k.label").toLowerCase()}), ${t("aq.cost.full")} = ${r.config.k_full}`],
     [t("aq.prov.shots"), fmt(r.config.shots, 0)],
     [t("aq.prov.seeds"), t("aq.prov.seedsVal", { full: r.metadata.simulation_seeds.full, aqft: r.metadata.simulation_seeds.aqft })],
     [t("aq.prov.noise"), `${presetLabel(state.resultPreset)} · ε1Q=${n.eps_1q} ε2Q=${n.eps_2q} ${n.t1_us == null ? "T1/T2=off" : `T1=${n.t1_us}µs T2=${n.t2_us}µs`} RO=${n.readout_0to1}/${n.readout_1to0}`],
     [t("aq.prov.model"), t("aq.prov.modelVal")],
     [t("aq.prov.method"), t("aq.prov.methodVal")]]
      .forEach(([dt, dd]) => { prov.append(el("dt", "", dt), el("dd", "", dd)); });

    if (state.resultK !== state.k || state.resultPreset !== state.preset) {
      if (!state.running && state.k !== K_FULL) {
        setStatus("aqRunStatus", "aq.run.stale", { k: state.resultK, preset: () => presetLabel(state.resultPreset) });
      }
    }
  }

  function renderDistChart(r) {
    const svg = $("aqDistChart");
    const W = 1120, H = 330, m = { top: 26, right: 24, bottom: 44, left: 58 };
    const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    const shots = r.config.shots;
    const full = r.full.distribution.map((c) => c / shots);
    const aq = r.aqft.distribution.map((c) => c / shots);
    const yMax = Math.ceil(Math.max(.02, ...full, ...aq) * 1.12 * 100) / 100;
    const x = (v) => m.left + (v / 255) * pw;
    const y = (p) => m.top + ph - (p / yMax) * ph;
    const bw = Math.max(1.2, (pw / 256) * .4);
    clearSvg(svg, t("aq.chart.svgTitle", { k: r.config.k }), t("aq.chart.help"));
    for (let i = 0; i <= 4; i += 1) {
      const p = (yMax * i) / 4;
      svg.append(svgNode("line", { x1: m.left, y1: y(p), x2: W - m.right, y2: y(p), class: "aq-grid" }));
      svg.append(svgNode("text", { x: m.left - 9, y: y(p) + 4, class: "aq-axis", "text-anchor": "end" }, pct(p, p < .1 ? 1 : 0)));
    }
    PEAKS.forEach((v) => {
      svg.append(svgNode("line", { x1: x(v), y1: m.top - 6, x2: x(v), y2: m.top + ph, class: "aq-peak" }));
    });
    const bars = (series, offset, cls, name) => series.forEach((p, v) => {
      if (p <= 0) return;
      const rect = svgNode("rect", { x: x(v) + offset, y: y(p), width: bw, height: m.top + ph - y(p), class: cls, rx: .6 });
      rect.append(svgNode("title", {}, t("aq.chart.bar", { serie: name, v, p: pct(p, 2), c: Math.round(p * shots) })));
      svg.append(rect);
    });
    bars(full, -bw - .25, "aq-bar-full", t("aq.series.full"));
    bars(aq, .25, "aq-bar-aqft", t("aq.series.aqft", { k: r.config.k }));
    [0, 32, 64, 96, 128, 160, 192, 224, 255].forEach((v) => {
      svg.append(svgNode("text", { x: x(v), y: H - 22, class: "aq-axis", "text-anchor": v === 0 ? "start" : v === 255 ? "end" : "middle" }, v));
    });
    $("aqDistSummary").textContent = t("aq.chart.summary", {
      full: pct(r.full.peak_mass, 1), aqft: pct(r.aqft.peak_mass, 1), n: 256 - PEAKS.length,
    });
  }

  // ------------------------------------------------------------------ curva
  function renderCurve() {
    const c = state.curve;
    const panel = $("aqCurvePanel");
    if (!c || !c.presets) { panel.hidden = true; return; }
    panel.hidden = false;
    const svg = $("aqCurveChart");
    const W = 920, H = 380, m = { top: 22, right: 150, bottom: 52, left: 62 };
    const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    const yMin = .2, yMax = .8;
    const X = (k) => m.left + ((k - 1) / (K_FULL - 1)) * pw;
    const Y = (v) => m.top + ph - ((v - yMin) / (yMax - yMin)) * ph;
    clearSvg(svg, t("aq.curve.chart"), t("aq.curve.intro").replace(/<[^>]+>/g, ""));
    for (let v = yMin; v <= yMax + 1e-9; v += .1) {
      svg.append(svgNode("line", { x1: m.left, y1: Y(v), x2: m.left + pw, y2: Y(v), class: "aq-grid" }));
      svg.append(svgNode("text", { x: m.left - 9, y: Y(v) + 4, class: "aq-axis", "text-anchor": "end" }, pct(v, 0)));
    }
    for (let k = 1; k <= K_FULL; k += 1) {
      svg.append(svgNode("text", { x: X(k), y: m.top + ph + 18, class: "aq-axis", "text-anchor": "middle" }, k));
    }
    svg.append(svgNode("rect", { x: X(state.k) - 14, y: m.top, width: 28, height: ph, class: "aq-curve-sel", rx: 6 }));
    [[c.ideal_factor_yield, "aq-line-ideal"], [c.random_factor_floor, "aq-line-floor"]].forEach(([v, cls]) => {
      svg.append(svgNode("line", { x1: m.left, y1: Y(v), x2: m.left + pw, y2: Y(v), class: cls }));
    });
    const legend = $("aqCurveLegend");
    legend.replaceChildren();
    PRESET_ORDER.forEach((name) => {
      const p = c.presets[name];
      if (!p) return;
      const color = PRESET_COLORS[name];
      const d = p.points.map((q, i) => `${i ? "L" : "M"}${X(q.k).toFixed(1)},${Y(q.factor_yield).toFixed(1)}`).join(" ");
      svg.append(svgNode("path", { d, fill: "none", stroke: color, "stroke-width": name === state.preset ? 2.6 : 1.6,
        opacity: name === state.preset ? 1 : .55 }));
      p.points.forEach((q) => {
        svg.append(svgNode("line", { x1: X(q.k), y1: Y(q.wilson_ci.low), x2: X(q.k), y2: Y(q.wilson_ci.high),
          stroke: color, "stroke-width": 1.2, opacity: .7 }));
        const dot = svgNode("circle", { cx: X(q.k), cy: Y(q.factor_yield), r: q.k === state.k && name === state.preset ? 5.5 : 3.2,
          fill: color, class: q.k === state.k && name === state.preset ? "aq-dot-sel" : "" });
        dot.append(svgNode("title", {}, `${presetLabel(name)} · k = ${q.k} · ${pct(q.factor_yield, 2)} [${pct(q.wilson_ci.low, 1)}; ${pct(q.wilson_ci.high, 1)}]`));
        svg.append(dot);
      });
      const last = p.points[p.points.length - 1];
      svg.append(svgNode("text", { x: m.left + pw + 10, y: Y(last.factor_yield) + 4, class: "aq-axis", fill: color }, presetLabel(name)));
      const item = el("span");
      const sw = el("i", "swatch");
      sw.style.background = color;
      item.append(sw, document.createTextNode(presetLabel(name)));
      legend.append(item);
    });
    svg.append(svgNode("text", { x: m.left + pw + 10, y: Y(c.ideal_factor_yield) - 6, class: "aq-axis aq-axis-ideal" },
      t("aq.curve.ideal", { v: pct(c.ideal_factor_yield, 0) })));
    svg.append(svgNode("text", { x: m.left + pw + 10, y: Y(c.random_factor_floor) + 14, class: "aq-axis aq-axis-floor" },
      t("aq.curve.floor", { v: pct(c.random_factor_floor, 1) })));
    svg.append(svgNode("text", { x: m.left + pw / 2, y: H - 10, class: "aq-axis", "text-anchor": "middle" }, t("aq.curve.axisX")));
    svg.append(svgNode("text", { x: 14, y: m.top + ph / 2, class: "aq-axis", "text-anchor": "middle",
      transform: `rotate(-90 14 ${m.top + ph / 2})` }, t("aq.curve.axisY")));

    $("aqCurveHelp").textContent = t("aq.curve.help", { shots: fmt(c.shots_per_point, 0) });
    const p = c.presets[state.preset];
    const full = p.points.find((q) => q.k === K_FULL);
    const best = p.points.find((q) => q.k === p.best_k);
    $("aqCurveVerdict").textContent = `${t("aq.curve.verdict", {
      preset: presetLabel(state.preset), full: pct(full.factor_yield, 1), best: pct(best.factor_yield, 1),
      k: best.k, delta: pp(best.factor_yield - full.factor_yield, 1),
    })} ${t("aq.curve.note")}`;
    $("aqCurveSource").textContent = t("aq.curve.source", {
      seed: c.seed_base, date: String(c.generato || "").slice(0, 10), sha: String(c.full_circuit_sha256 || "").slice(0, 12),
    });
  }

  // ------------------------------------------------------------------ tesi
  function table(host, head, rows) {
    host.replaceChildren();
    const thead = el("thead");
    const tr = el("tr");
    head.forEach((h) => tr.append(el("th", "", h)));
    thead.append(tr);
    const tbody = el("tbody");
    rows.forEach(({ cells, cls }) => {
      const row = el("tr", cls || "");
      cells.forEach((cell) => row.append(el("td", "", cell)));
      tbody.append(row);
    });
    host.append(thead, tbody);
  }

  function renderThesis() {
    const d = state.tesi;
    const panel = $("aqThesisPanel");
    if (!d || !d.n15) { panel.hidden = true; return; }
    panel.hidden = false;
    const n15 = d.n15;

    // Grafico N=15: barre ECR (asse destro) e resa holdout (asse sinistro).
    const svg = $("aqN15Chart");
    const W = 920, H = 330, m = { top: 24, right: 70, bottom: 48, left: 62 };
    const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    const X = (k) => m.left + ((k - .5) / K_FULL) * pw;
    const yMin = .4, yMax = .7;
    const Y = (v) => m.top + ph - ((v - yMin) / (yMax - yMin)) * ph;
    const ecrMax = 400;
    const YE = (v) => m.top + ph - (v / ecrMax) * ph;
    clearSvg(svg, t("aq.thesis.n15.svgTitle"), t("aq.thesis.n15.svgDesc"));
    for (let v = yMin; v <= yMax + 1e-9; v += .05) {
      svg.append(svgNode("line", { x1: m.left, y1: Y(v), x2: m.left + pw, y2: Y(v), class: "aq-grid" }));
      svg.append(svgNode("text", { x: m.left - 9, y: Y(v) + 4, class: "aq-axis", "text-anchor": "end" }, pct(v, 0)));
    }
    [0, 100, 200, 300, 400].forEach((v) => {
      svg.append(svgNode("text", { x: m.left + pw + 9, y: YE(v) + 4, class: "aq-axis aq-axis-ecr" }, v));
    });
    const bw = pw / K_FULL * .42;
    n15.grid.forEach((g) => {
      const rect = svgNode("rect", { x: X(g.k) - bw / 2, y: YE(g.ecr), width: bw, height: m.top + ph - YE(g.ecr), rx: 4,
        class: `aq-ecr-bar${g.k === n15.selected_k ? " is-selected" : ""}` });
      rect.append(svgNode("title", {}, `k = ${g.k} · ECR ${g.ecr} · depth ${g.depth}`));
      svg.append(rect);
      svg.append(svgNode("text", { x: X(g.k), y: m.top + ph - 8, class: "aq-axis aq-axis-ecr", "text-anchor": "middle" }, g.ecr));
      svg.append(svgNode("text", { x: X(g.k), y: m.top + ph + 18, class: "aq-axis", "text-anchor": "middle" },
        g.k === K_FULL ? `7 · ${t("aq.thesis.full")}` : g.k));
    });
    const path = n15.grid.map((g, i) => `${i ? "L" : "M"}${X(g.k).toFixed(1)},${Y(g.holdout).toFixed(1)}`).join(" ");
    svg.append(svgNode("path", { d: path, class: "aq-n15-line" }));
    n15.grid.forEach((g) => {
      const se = Math.sqrt(g.holdout * (1 - g.holdout) / g.holdout_shots);
      svg.append(svgNode("line", { x1: X(g.k), y1: Y(g.holdout - 1.96 * se), x2: X(g.k), y2: Y(g.holdout + 1.96 * se), class: "aq-n15-err" }));
      const dot = svgNode("circle", { cx: X(g.k), cy: Y(g.holdout), r: g.k === n15.selected_k ? 6 : 4,
        class: `aq-n15-dot${g.k === n15.selected_k ? " is-selected" : ""}` });
      dot.append(svgNode("title", {}, `k = ${g.k} · holdout ${pct(g.holdout, 2)}`));
      svg.append(dot);
    });
    svg.append(svgNode("text", { x: 14, y: m.top + ph / 2, class: "aq-axis", "text-anchor": "middle",
      transform: `rotate(-90 14 ${m.top + ph / 2})` }, t("aq.thesis.n15.axisY")));
    svg.append(svgNode("text", { x: W - 12, y: m.top + ph / 2, class: "aq-axis aq-axis-ecr", "text-anchor": "middle",
      transform: `rotate(90 ${W - 12} ${m.top + ph / 2})` }, t("aq.thesis.n15.ecr")));

    table($("aqN15Table"),
      [t("aq.thesis.col.k"), t("aq.thesis.col.ecr"), t("aq.thesis.col.depth"), t("aq.thesis.col.train"), t("aq.thesis.col.holdout")],
      n15.grid.map((g) => ({
        cls: g.k === n15.selected_k ? "is-selected" : g.is_full ? "is-full" : "",
        cells: [
          g.k === n15.selected_k ? `${g.k} · ${t("aq.thesis.selected")}` : g.is_full ? `${g.k} · ${t("aq.thesis.full")}` : String(g.k),
          fmt(g.ecr, 0), fmt(g.depth, 0), fmt(g.train, 4), fmt(g.holdout, 4)],
      })));
    $("aqN15Verdict").innerHTML = t("aq.thesis.n15.verdict", {
      k: n15.selected_k, full: fmt(n15.full_holdout, 4), sel: fmt(n15.selected_holdout, 4),
      delta: `+${fmt(n15.contrast.difference, 4)}`, lo: fmt(n15.contrast.low, 4), hi: fmt(n15.contrast.high, 4),
      ecr: n15.ecr.delta, ref: n15.ecr.reference, now: n15.ecr.selected,
    });
    $("aqN15Source").textContent = t("aq.thesis.n15.source", {
      file: n15.fonte.file.split("/").pop(), seed: n15.seed,
      cal: String(n15.calibration_sha256 || "").slice(0, 10), sha: String(n15.canonical_circuit_sha256 || "").slice(0, 10),
    });

    const n21 = d.n21;
    table($("aqN21Table"),
      [t("aq.thesis.n21.factor"), t("aq.thesis.n21.full"), t("aq.thesis.n21.trunc"), t("aq.thesis.n21.delta")],
      n21.rows.map((row) => ({
        cls: row.contrast.high < 0 || row.contrast.low > 0 ? "is-selected" : "",
        cells: [fmt(row.noise_factor, 3), fmt(row.full_holdout, 4), fmt(row.truncated_holdout, 4),
          `${row.contrast.difference > 0 ? "+" : row.contrast.difference < 0 ? "−" : ""}${fmt(Math.abs(row.contrast.difference), 3)} [${fmt(row.contrast.low, 3)}; ${fmt(row.contrast.high, 3)}]`],
      })));
    $("aqN21Verdict").textContent = t("aq.thesis.n21.verdict", {
      full: fmt(n21.ecr.full, 0), trunc: fmt(n21.ecr.truncated, 0),
      pct: pct(1 - n21.ecr.truncated / n21.ecr.full, 1),
    });
    $("aqN21Source").textContent = t("aq.thesis.n21.source", { n: n21.fonti.length });

    renderForest(d.qpe);
  }

  function renderForest(qpe) {
    const svg = $("aqQpeChart");
    const W = 520, H = 330, m = { top: 18, right: 22, bottom: 44, left: 128 };
    const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    const lo = -.05, hi = .2;
    const X = (v) => m.left + ((v - lo) / (hi - lo)) * pw;
    const rows = qpe.contrasts;
    const rowH = ph / rows.length;
    clearSvg(svg, t("aq.thesis.qpe.svgTitle"), t("aq.thesis.qpe.svgDesc"));
    [-.05, 0, .05, .1, .15, .2].forEach((v) => {
      svg.append(svgNode("line", { x1: X(v), y1: m.top, x2: X(v), y2: m.top + ph, class: v === 0 ? "aq-zero" : "aq-grid" }));
      svg.append(svgNode("text", { x: X(v), y: m.top + ph + 16, class: "aq-axis", "text-anchor": "middle" }, `${v > 0 ? "+" : ""}${fmt(v * 100, 0)}`));
    });
    rows.forEach((c, i) => {
      const y = m.top + rowH * (i + .5);
      if (i % 3 === 0) {
        svg.append(svgNode("text", { x: 8, y: y + 4, class: "aq-axis aq-forest-n" }, `n = ${c.n}`));
      }
      svg.append(svgNode("text", { x: m.left - 10, y: y + 4, class: "aq-axis", "text-anchor": "end" },
        c.representable ? `${c.phase} · ${t("aq.thesis.qpe.exact")}` : c.phase));
      const sig = c.low > 0;
      svg.append(svgNode("line", { x1: X(c.low), y1: y, x2: X(c.high), y2: y, class: `aq-forest-ci${sig ? " is-sig" : ""}` }));
      const dot = svgNode("circle", { cx: X(c.difference), cy: y, r: 4.2, class: `aq-forest-dot${sig ? " is-sig" : ""}` });
      dot.append(svgNode("title", {}, `n = ${c.n}, φ = ${c.phase}, k = ${c.k_selected}/${c.k_full}: ${pp(c.difference, 2)} [${pp(c.low, 2)}; ${pp(c.high, 2)}] · ECR −${c.ecr_saved}`));
      svg.append(dot);
    });
    svg.append(svgNode("text", { x: m.left + pw / 2, y: H - 8, class: "aq-axis", "text-anchor": "middle" }, `${t("aq.thesis.qpe.axis")} (pp)`));
    const max = rows.reduce((a, b) => (b.difference > a.difference ? b : a));
    $("aqQpeVerdict").textContent = t("aq.thesis.qpe.verdict", {
      pos: qpe.positive, n: rows.length, ex: qpe.excluding_zero, max: pp(max.difference, 1), nmax: max.n, ecr: max.ecr_saved,
    });
    $("aqQpeSource").textContent = t("aq.thesis.qpe.source", { file: qpe.fonte.file.split("/").pop(), shots: fmt(qpe.shots, 0) });
  }

  // ------------------------------------------------------------------ stadi
  /* Stesso circuito di Shor con QFT piena e con QFT troncata, stadio per stadio.
     Le sfere arrivano da /api/aqft/bloch, precalcolate per ogni k con i tre preset: una
     richiesta per volta, perche' il server ha uno slot solo. */
  const stadi = { modo: "ideale", indice: 0, dati: null, chiave: "", token: 0, loading: false, playing: false, timer: null };
  const cacheStadi = new Map();
  let codaStadi = Promise.resolve();
  const rumoreStadi = () => (stadi.modo === "rumore" ? PRESETS[state.preset] : {});

  async function chiediStadi(k, noise) {
    const chiave = `${k}|${JSON.stringify(noise)}`;
    if (cacheStadi.has(chiave)) return cacheStadi.get(chiave);
    for (let tentativo = 0; ; tentativo += 1) {
      try {
        const dati = await apiJSON("/api/aqft/bloch", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ k, noise }),
        });
        cacheStadi.set(chiave, dati);
        return dati;
      } catch (error) {
        if (error.status !== 429 || tentativo >= 20) throw error;
        setStatus("aqStadiStatus", "aq.stadi.busy", null, "loading");
        await new Promise((r) => window.setTimeout(r, 2500));
      }
    }
  }

  // Il precalcolo copre ogni grado con i preset della scheda (precalcola_aqft_bloch.py).
  // Il pulsante "Calcola" resta come ripiego se il file manca: senza precalcolo servono
  // circa due minuti di simulazione su Render, e lo slider non deve lanciarli da solo.
  const kPrecalcolato = (k) => Number.isInteger(k) && k >= 1 && k <= K_FULL;
  function caricaStadi({ forza = false } = {}) {
    if (!kPrecalcolato(state.k) && !forza) {
      ++stadi.token;
      stadi.dati = null;
      stadi.chiave = "";
      stadi.loading = false;
      setStatus("aqStadiStatus", "aq.stadi.needCompute", { k: state.k });
      $("aqStadiCalcola").hidden = false;
      renderStadiControlli();
      ["aqStadiFullSvg", "aqStadiAqftSvg"].forEach((id) => $(id).replaceChildren());
      $("aqStadiVerdict").textContent = "";
      return codaStadi;
    }
    $("aqStadiCalcola").hidden = true;
    const token = ++stadi.token;
    const k = state.k;
    const noise = rumoreStadi();
    const chiave = `${k}|${stadi.modo}|${JSON.stringify(noise)}`;
    if (chiave === stadi.chiave && stadi.dati) { renderStadi(); return codaStadi; }
    stadi.loading = true;
    const precalcolato = kPrecalcolato(k);
    setStatus("aqStadiStatus", precalcolato ? "aq.stadi.loading" : "aq.stadi.loadingLive", { k }, "loading");
    renderStadiControlli();
    codaStadi = codaStadi.then(async () => {
      if (token !== stadi.token) return;
      try {
        const full = await chiediStadi(K_FULL, noise);
        const aqft = k === K_FULL ? full : await chiediStadi(k, noise);
        const ideale = stadi.modo === "rumore" ? await chiediStadi(K_FULL, {}) : full;
        if (token !== stadi.token) return;
        stadi.dati = { full, aqft, ideale, k };
        stadi.chiave = chiave;
        stadi.indice = Math.min(stadi.indice, full.stages.length - 1);
        stadi.loading = false;
        setStatus("aqStadiStatus", "aq.stadi.ready", { modo: () => t(stadi.modo === "rumore" ? "aq.stadi.noisy" : "aq.stadi.ideal").toLowerCase() }, "success");
        renderStadi();
      } catch (error) {
        if (token !== stadi.token) return;
        stadi.loading = false;
        setStatus("aqStadiStatus", "aq.stadi.error", { msg: error.message }, "error");
        renderStadiControlli();
      }
    }).catch(() => {});
    return codaStadi;
  }

  function lunghezzaMediaPuri(dati, ideale, indice) {
    const rif = ideale.stages[indice].qubits;
    const puri = rif.filter((q) => q.len > 0.99).map((q) => q.i);
    if (!puri.length) return null;
    const qubits = dati.stages[indice].qubits;
    return puri.reduce((s, i) => s + qubits[i].len, 0) / puri.length;
  }

  function renderStadiControlli() {
    $("aqStadiIdeale").classList.toggle("is-active", stadi.modo === "ideale");
    $("aqStadiRumore").classList.toggle("is-active", stadi.modo === "rumore");
    $("aqStadiIdeale").setAttribute("aria-pressed", String(stadi.modo === "ideale"));
    $("aqStadiRumore").setAttribute("aria-pressed", String(stadi.modo === "rumore"));
    const n = stadi.dati ? stadi.dati.full.stages.length : 0;
    $("aqStadiCounter").textContent = n ? `${stadi.indice + 1} / ${n}` : "— / —";
    $("aqStadiChip").textContent = n ? t("aq.stadi.chip", { i: stadi.indice + 1, n }) : "—";
    $("aqStadiPrev").disabled = !n || stadi.indice <= 0;
    $("aqStadiNext").disabled = !n || stadi.indice >= n - 1;
    $("aqStadiPlay").disabled = !n || stadi.loading;
    $("aqStadiPlay").textContent = t(stadi.playing ? "btn.pause" : "btn.playAuto");
    $("aqStadiAqftTitle").textContent = t("aq.stadi.aqftTitle", { k: state.k });
    const kicker = stadi.modo === "rumore" ? t("aq.stadi.kickerNoisy", { preset: presetLabel(state.preset) }) : t("aq.stadi.kickerIdeal");
    $("aqStadiFullKicker").textContent = kicker;
    $("aqStadiAqftKicker").textContent = kicker;
  }

  function renderStadi() {
    renderStadiControlli();
    const d = stadi.dati;
    if (!d || !window.ShorDemo) return;
    const i = stadi.indice;
    window.ShorDemo.disegnaCircuito("aqStadiFullSvg", { ...d.full.stages[i], n_count: d.full.n_count }, "QFT⁻¹");
    window.ShorDemo.disegnaCircuito("aqStadiAqftSvg", { ...d.aqft.stages[i], n_count: d.aqft.n_count },
      d.k === K_FULL ? "QFT⁻¹" : `QFT⁻¹ · k=${d.k}`);
    const qft = d.full.stages.findIndex((s) => s.kind === "qft");
    const verdetto = $("aqStadiVerdict");
    if (d.k === K_FULL) {
      verdetto.textContent = t("aq.stadi.fullOnly");
    } else if (i < qft) {
      verdetto.textContent = t("aq.stadi.before");
    } else if (stadi.modo === "ideale") {
      verdetto.textContent = t("aq.stadi.sameIdeal", { k: d.k });
    } else {
      const lf = lunghezzaMediaPuri(d.full, d.ideale, i);
      const la = lunghezzaMediaPuri(d.aqft, d.ideale, i);
      verdetto.innerHTML = "";
      const testo = t("aq.stadi.compareNoisy", { full: "§F", aqft: "§A" });
      const [prima, resto] = testo.split("§F");
      const [mezzo, dopo] = resto.split("§A");
      const bF = el("strong", "aq-len-full", lf == null ? "—" : fmt(lf, 2));
      const bA = el("strong", "aq-len-aqft", la == null ? "—" : fmt(la, 2));
      bF.id = "aqStadiLenFull";
      bA.id = "aqStadiLenAqft";
      verdetto.append(document.createTextNode(prima), bF, document.createTextNode(mezzo), bA, document.createTextNode(dopo));
    }
  }

  function vaiStadio(i) {
    if (!stadi.dati) return;
    stadi.indice = Math.max(0, Math.min(stadi.dati.full.stages.length - 1, i));
    renderStadi();
  }

  function fermaStadi() {
    stadi.playing = false;
    if (stadi.timer) window.clearTimeout(stadi.timer);
    stadi.timer = null;
    renderStadiControlli();
  }

  function playStadi() {
    if (stadi.playing) { fermaStadi(); return; }
    if (!stadi.dati) return;
    if (stadi.indice >= stadi.dati.full.stages.length - 1) vaiStadio(0);
    stadi.playing = true;
    renderStadiControlli();
    const passo = () => {
      if (!stadi.playing) return;
      if (stadi.indice >= stadi.dati.full.stages.length - 1) { fermaStadi(); return; }
      vaiStadio(stadi.indice + 1);
      stadi.timer = window.setTimeout(passo, 1600);
    };
    stadi.timer = window.setTimeout(passo, 1000);
  }

  function modoStadi(modo) {
    fermaStadi();
    stadi.modo = modo;
    renderStadiControlli();
    return caricaStadi();
  }

  // ------------------------------------------------------------------ ciclo
  function renderAll() {
    renderDegree();
    renderCircuit();
    renderDistance();
    renderCost();
    renderIdeal();
    renderPresets();
    renderResult();
    renderCurve();
    renderThesis();
    if (stadi.dati) renderStadi(); else renderStadiControlli();
    statuses.forEach((_, id) => renderStatus(id));
  }

  function setK(k) {
    state.k = k;
    $("aqK").value = String(k);
    renderAll();
    pianificaStadi();
  }

  // Lo slider cambia k a ogni tacca: si ricaricano le sfere solo quando si ferma.
  let attesaStadi = null;
  function pianificaStadi() {
    if (attesaStadi) window.clearTimeout(attesaStadi);
    attesaStadi = window.setTimeout(() => { attesaStadi = null; caricaStadi(); }, 600);
  }

  async function load() {
    setStatus("aqStatus", "aq.status.loading", null, "loading");
    try {
      state.structure = await apiJSON("/api/aqft/structure");
      setStatus("aqStatus", "aq.status.ready", null, "success");
    } catch (error) {
      setStatus("aqStatus", "aq.status.error", { msg: error.message }, "error");
    }
    renderAll();
    const [curve, tesi] = await Promise.all([
      apiJSON("/api/aqft/curva").catch(() => null),
      apiJSON("/api/aqft/tesi").catch(() => null),
    ]);
    state.curve = curve && curve.presets ? curve : null;
    state.tesi = tesi && tesi.n15 ? tesi : null;
    renderCurve();
    renderThesis();
    caricaStadi();
  }

  function init() {
    if (!$("aqftPanel")) return;
    $("aqK").addEventListener("input", (event) => setK(Number(event.target.value)));
    document.querySelectorAll("[data-aq-preset]").forEach((button) => {
      button.addEventListener("click", () => { state.preset = button.dataset.aqPreset; renderAll(); if (stadi.modo === "rumore") caricaStadi(); });
    });
    $("aqRunBtn").addEventListener("click", runExperiment);
    $("aqStadiIdeale").addEventListener("click", () => modoStadi("ideale"));
    $("aqStadiRumore").addEventListener("click", () => modoStadi("rumore"));
    $("aqStadiPrev").addEventListener("click", () => { fermaStadi(); vaiStadio(stadi.indice - 1); });
    $("aqStadiNext").addEventListener("click", () => { fermaStadi(); vaiStadio(stadi.indice + 1); });
    $("aqStadiPlay").addEventListener("click", playStadi);
    $("aqStadiCalcola").addEventListener("click", () => caricaStadi({ forza: true }));
    I18N.onChange(renderAll);
    renderAll();
    load();
  }

  // Aggancio per eventuali tour: stesse funzioni dei controlli.
  window.ShorAqft = Object.freeze({
    // Lo stesso disegno della QFT inversa, piena, per il simulatore ideale.
    disegnaQftInversa: (svg, opzioni) => disegnaQftInversa(svg, opzioni),
    grado: (k) => setK(Math.min(K_FULL, Math.max(1, Number(k) || 1))),
    preset: (nome) => { if (PRESETS[nome]) { state.preset = nome; renderAll(); } },
    confronta: () => runExperiment(),
    pronta: () => Boolean(state.structure) && Boolean(state.tesi) && Boolean(state.curve),
    inCorsa: () => state.running,
    haRisultato: () => Boolean(state.result) && !state.running,
    seed: (n) => { $("aqSeed").value = String(n); },
    // Vista stadio per stadio (copione "passaggi" del tour).
    stadiModo: (modo) => modoStadi(modo),
    stadiVai: (i) => { fermaStadi(); vaiStadio(i); },
    stadiPronti: () => Boolean(stadi.dati) && !stadi.loading,
    stadiQft: () => (stadi.dati ? stadi.dati.full.stages.findIndex((s) => s.kind === "qft") : -1),
    shot: (n) => { $("aqShots").value = String(n); },
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
