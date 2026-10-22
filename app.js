// app.js — l'écran : menu, partie contre le bot, fin de partie, analyse, parties passées.
(function () {
  'use strict';
  const GG = window.GoGoban, SIT = window.GoSituation, FIN = window.GoFin, BOT = window.GoBot, AN = window.GoAnalyse, PL = window.GoPlateau;
  const { NOIR, BLANC, PASSE, VIDE } = GG;
  const CLE = 'go-v1';
  const KOMI = { 9: 6.5, 13: 7.5, 19: 7.5 };
  const TAILLES = [9, 13, 19];
  const NIV_MAX = 39;                                  // curseur 0..39  <->  30 kyu .. 9 dan +
  const kDepuisIdx = (i) => 30 - i, idxDepuisK = (k) => 30 - k;
  const nomNiv = (k) => BOT.nomNiveau(k);
  const ORDRE = ['brillant', 'tres_bon', 'meilleur', 'bon', 'theorique', 'erreur', 'manque', 'gaffe'];
  const MAUVAIS = { erreur: 1, manque: 1, gaffe: 1 };

  const fr = (x, d) => (+x).toFixed(d === undefined ? 1 : d).replace('.', ',');
  const pts = (x) => { const v = Math.round(x * 10) / 10; return fr(v) + (Math.abs(v) >= 2 ? ' points' : ' point'); };
  const coul = (c) => (c === NOIR ? 'Noir' : 'Blanc');
  const echap = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- dessins ---------- */
  const dessin = (d) => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const IC = {
    retour: dessin('<path d="M15 5l-7 7 7 7"/>'),
    debut: dessin('<path d="M6 5v14"/><path d="M18 5l-8 7 8 7z"/>'),
    prec: dessin('<path d="M16 5l-8 7 8 7z"/>'),
    suiv: dessin('<path d="M8 5l8 7-8 7z"/>'),
    fin: dessin('<path d="M18 5v14"/><path d="M6 5l8 7-8 7z"/>'),
    plus: dessin('<path d="M12 5v14M5 12h14"/>'),
    moins: dessin('<path d="M5 12h14"/>'),
    croix: dessin('<path d="M6 6l12 12M18 6L6 18"/>'),
    ok: dessin('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    poubelle: dessin('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
  };
  const pierre = (c, cl) => `<i class="pierre ${c === NOIR ? 'n' : 'b'}${cl ? ' ' + cl : ''}"></i>`;

  /* ---------- sauvegarde dans le navigateur ---------- */
  let memoire = null;
  function lireStock() { try { const t = localStorage.getItem(CLE); return t ? JSON.parse(t) : null; } catch (e) { return memoire; } }
  function normaliser(s) {
    s = s && typeof s === 'object' ? s : {};
    const r = Object.assign({ taille: 9, niveau: 12, couleur: 'noir', confirmer: true }, s.reglages || {});
    if (TAILLES.indexOf(r.taille) < 0) r.taille = 9;
    r.niveau = Math.max(-9, Math.min(30, Math.round(+r.niveau || 12)));
    return { reglages: r, enCours: s.enCours || null, historique: Array.isArray(s.historique) ? s.historique : [] };
  }
  let stock = normaliser(lireStock());
  function ecrire() {
    let t;
    try { t = JSON.stringify(stock); } catch (e) { return; }
    try { localStorage.setItem(CLE, t); }
    catch (e) {
      try {                                    // plein ? on allège les vieilles analyses et on réessaie une fois
        for (let i = 6; i < stock.historique.length; i++) stock.historique[i].analyse = null;
        localStorage.setItem(CLE, JSON.stringify(stock));
      } catch (e2) { try { memoire = JSON.parse(t); } catch (e3) { /* tant pis */ } }
    }
  }

  /* ---------- état ---------- */
  const moteur = new window.GoMoteur.Moteur();
  let ecran = 'menu';           // menu | jeu | revue | historique
  let G = null;                 // partie en cours
  let R = null;                 // partie en revue
  let reqId = 0;
  let confirmeSuppr = null;
  let origineRevue = 'jeu';
  let erreurMoteur = null;
  let lenteur = false;          // le bot met longtemps à charger (connexion lente ?)
  const racine = () => document.getElementById('app');

  // on surveille le démarrage du « cerveau » du bot (le réseau se charge dans un worker)
  function surveillerMoteur() {
    erreurMoteur = null;
    if (!moteur.wasm) { erreurMoteur = 'wasm'; return; }
    lenteur = false;
    setTimeout(() => { if (!moteur.pret && !erreurMoteur) { lenteur = true; if (ecran === 'jeu') rendre(); } }, 15000);
    moteur.attendre().then(() => { if (ecran === 'jeu') rendre(); })
      .catch((e) => { erreurMoteur = (e && e.wasm) ? 'wasm' : 'autre'; if (ecran === 'jeu' || ecran === 'menu') rendre(); });
  }
  surveillerMoteur();

  /* ---------- parties ---------- */
  function nouvellePartie(n, k, humain) {
    const komi = KOMI[n];
    return {
      id: Date.now(), date: Date.now(), n, komi, k, humain, coups: [], sit: SIT.Situation.initiale(n, komi),
      phase: 'jeu', fantome: null, pense: false, mortes: new Set(), message: '', confirmeAbandon: false, resultat: null, analyse: null,
    };
  }
  function restaurer(s) {
    const g = nouvellePartie(s.n, s.k, s.humain);
    g.id = s.id; g.date = s.date;
    for (const c of s.coups) { g.coups.push([c[0], c[1]]); g.sit = g.sit.jouer(c[1], c[0], true); }
    g.phase = s.phase === 'marquage' ? 'marquage' : 'jeu';
    g.mortes = new Set(s.mortes || []);
    return g;
  }
  function sauverPartie() {
    if (!G) return;
    if (G.phase === 'jeu' || G.phase === 'marquage') {
      stock.enCours = { id: G.id, date: G.date, n: G.n, k: G.k, humain: G.humain, coups: G.coups, phase: G.phase, mortes: Array.from(G.mortes) };
    } else stock.enCours = null;
    ecrire();
  }
  const botCouleur = () => 3 - G.humain;

  function raisonInterdit(sit, loc, pla) {
    const g = sit.g;
    if (g.c[loc] !== VIDE) return 'Cette case est occupée.';
    if (loc === g.ko) return 'Ko : jouez ailleurs avant de reprendre.';
    if (g.estSuicideInterdit(loc, pla, false)) return 'Coup suicide : interdit.';
    return 'Position déjà vue : interdit (super-ko).';
  }

  function appliquer(pla, loc) {
    G.coups.push([pla, loc]);
    G.sit = G.sit.jouer(loc, pla, true);
    G.fantome = null;
    G.message = '';
    if (G.sit.termine) { debutMarquage(); return; }
    sauverPartie();
    rendre();
  }

  function jouerHumain(loc) {
    if (!G || G.phase !== 'jeu' || G.pense || G.sit.trait !== G.humain) return;
    if (loc !== PASSE && !G.sit.estLegal(loc, G.humain)) { G.fantome = null; G.message = raisonInterdit(G.sit, loc, G.humain); rendre(); return; }
    appliquer(G.humain, loc);
    if (G && G.phase === 'jeu') demanderBot();
  }

  function demanderBot() {
    if (!G || G.phase !== 'jeu' || G.sit.termine || G.sit.trait === G.humain || G.pense) return;
    const mien = G, id = ++reqId, t0 = Date.now();
    G.pense = true; rendre();
    moteur.jouer({ n: G.n, komi: G.komi, coups: G.coups, k: G.k }).then((r) => {
      const delai = Math.max(0, 500 - (Date.now() - t0));
      setTimeout(() => {
        if (G !== mien || id !== reqId || G.phase !== 'jeu') return;
        G.pense = false;
        appliquer(botCouleur(), r.loc);
        if (G === mien && G.phase === 'jeu' && r.loc === PASSE) { G.message = 'Le bot passe.'; rendre(); }
      }, delai);
    }).catch(() => {
      if (G !== mien || id !== reqId) return;
      G.pense = false; G.message = 'Le bot n\'a pas répondu. Touchez « Réessayer ».'; G.erreurBot = true; rendre();
    });
  }

  /* ---------- fin de partie : marquer les pierres mortes, compter ---------- */
  function debutMarquage() {
    const mien = G;
    G.phase = 'marquage'; G.pense = false; G.fantome = null; G.mortes = new Set();
    G.message = 'Le bot regarde quelles pierres sont mortes…';
    sauverPartie(); rendre();
    moteur.fin({ n: G.n, komi: G.komi, coups: G.coups }).then((r) => {
      if (G !== mien || G.phase !== 'marquage') return;
      G.mortes = new Set(r.mortes);
      G.message = 'Touchez un groupe pour le déclarer mort ou vivant.';
      sauverPartie(); rendre();
    }).catch(() => {
      if (G !== mien || G.phase !== 'marquage') return;
      G.message = 'Touchez un groupe pour le déclarer mort ou vivant.'; rendre();
    });
  }
  function basculerGroupe(loc) {
    const g = G.sit.g;
    if (g.c[loc] !== NOIR && g.c[loc] !== BLANC) return;
    const ch = FIN.chaines(g).find((c) => c.pierres.indexOf(loc) >= 0);
    if (!ch) return;
    const mort = G.mortes.has(loc);
    for (const p of ch.pierres) { if (mort) G.mortes.delete(p); else G.mortes.add(p); }
    sauverPartie(); rendre();
  }
  function continuerAJouer() {
    // on retire les deux passes : celui qui a passé le premier rejoue
    let c = G.coups.slice();
    for (let i = 0; i < 2 && c.length && c[c.length - 1][1] === PASSE; i++) c.pop();
    const g2 = nouvellePartie(G.n, G.k, G.humain);
    g2.id = G.id; g2.date = G.date;
    for (const m of c) { g2.coups.push(m); g2.sit = g2.sit.jouer(m[1], m[0], true); }
    G = g2; G.message = 'La partie continue.';
    ++reqId; sauverPartie(); rendre();
    if (G.sit.trait !== G.humain) demanderBot();
  }
  function valider() {
    const f = FIN.scoreFinal(G.sit, Array.from(G.mortes));
    G.resultat = { gagnant: f.gagnant, diff: f.diff, noir: f.noir, blanc: f.blanc, komi: f.komi, abandon: false };
    terminer();
  }
  function abandonner() {
    G.resultat = { gagnant: botCouleur(), abandon: true, komi: G.komi };
    G.confirmeAbandon = false;
    terminer();
  }
  function terminer() {
    G.phase = 'fini'; G.pense = false; G.message = ''; ++reqId;
    const entree = { id: G.id, date: Date.now(), n: G.n, komi: G.komi, k: G.k, humain: G.humain, coups: G.coups, mortes: Array.from(G.mortes), resultat: G.resultat, analyse: null };
    G.entree = entree;
    stock.historique = [entree].concat(stock.historique.filter((e) => e.id !== G.id)).slice(0, 30);
    stock.enCours = null; ecrire();
    lancerAnalyse(G);
    rendre();
  }

  /* ---------- analyse ---------- */
  function lancerAnalyse(partie) {
    const entree = partie.entree;
    const T = entree.coups.length;
    partie.analyse = { etat: T < 2 ? 'rien' : 'calcul', progres: 0 };
    if (T < 2) return;
    moteur.analyser({ n: entree.n, komi: entree.komi, coups: entree.coups }, (p) => {
      partie.analyse.progres = p; majProgres(partie);
    }).then((res) => {
      if (!res) { if (partie.analyse.etat === 'calcul') partie.analyse.etat = 'erreur'; return; }
      entree.analyse = compacter(res);
      partie.analyse.etat = 'pret';
      ecrire();
      moteur.liberer();
      if (G === partie && ecran === 'jeu') rendre();
      if (ecran === 'historique') rendre();
    }).catch(() => { partie.analyse.etat = 'erreur'; if (G === partie && ecran === 'jeu') rendre(); });
  }
  function majProgres(partie) {
    if (G !== partie || ecran !== 'jeu') return;
    const b = document.getElementById('prog'), t = document.getElementById('progTxt');
    const p = Math.round(partie.analyse.progres * 100);
    if (b) b.style.width = p + '%';
    if (t) t.textContent = 'Analyse en cours… ' + p + ' %';
  }
  function compacter(res) {
    return {
      j: res.joueurs,
      m: res.coups.map((d) => [ORDRE.indexOf(d.classe), Math.round(d.perte * 10), Math.round(d.pertePct * 1000), d.meilleurLoc || 0,
        Math.round(d.gainAvant * 1000), Math.round(d.gainApres * 1000), Math.round(d.leadAvant * 10), Math.round(d.leadApres * 10)]),
      g: res.courbe.map((c) => (c ? Math.round(c.gainNoir * 1000) : 500)),
    };
  }
  function deplier(entree) {
    const a = entree.analyse;
    const infos = a.m.map((m, i) => ({
      i, joueur: entree.coups[i][0], loc: entree.coups[i][1], classe: ORDRE[m[0]] || 'bon', perte: m[1] / 10, pertePct: m[2] / 1000,
      meilleurLoc: m[3], gainAvant: m[4] / 1000, gainApres: m[5] / 1000, leadAvant: m[6] / 10, leadApres: m[7] / 10,
    }));
    return { infos, gains: a.g.map((x) => x / 1000), joueurs: a.j };
  }

  function ouvrirRevue(entree, onglet) {
    if (!entree.analyse) return;
    const d = deplier(entree);
    const sits = [SIT.Situation.initiale(entree.n, entree.komi)];
    for (const c of entree.coups) sits.push(sits[sits.length - 1].jouer(c[1], c[0], true));
    R = { entree, n: entree.n, humain: entree.humain, k: entree.k, coups: entree.coups, infos: d.infos, gains: d.gains, joueurs: d.joueurs, sits, cur: 0, onglet: onglet || 'resume' };
    ecran = 'revue'; rendre(); window.scrollTo(0, 0);
  }

  /* ---------- vues ---------- */
  function vueMenu() {
    const r = stock.reglages, enCours = stock.enCours, nbHist = stock.historique.length;
    const seg = (act, items, courant) => '<div class="seg">' + items.map((it) => `<button class="seg-b${courant === it.v ? ' on' : ''}" data-act="${act}" data-v="${it.v}">${it.t}</button>`).join('') + '</div>';
    return `<div class="menu">
      <p class="marque">Go</p>
      <div class="bloc">${seg('taille', TAILLES.map((t) => ({ v: t, t: t + '×' + t })), r.taille)}</div>
      <div class="bloc niv">
        <div class="niv-ligne">
          <button class="rond" data-act="niv-" aria-label="Moins fort">${IC.moins}</button>
          <div class="niv-val"><b id="nivNom">${nomNiv(r.niveau)}</b><small>niveau estimé</small></div>
          <button class="rond" data-act="niv+" aria-label="Plus fort">${IC.plus}</button>
        </div>
        <input id="nivRange" class="curseur" type="range" min="0" max="${NIV_MAX}" step="1" value="${idxDepuisK(r.niveau)}" aria-label="Niveau du bot">
        <div class="niv-bornes"><span>30 kyu</span><span>9 dan +</span></div>
      </div>
      <div class="bloc">${seg('couleur', [{ v: 'noir', t: pierre(NOIR) + 'Noir' }, { v: 'blanc', t: pierre(BLANC) + 'Blanc' }, { v: 'hasard', t: 'Hasard' }], r.couleur)}</div>
      <button class="interrupteur" data-act="confirmer" role="switch" aria-checked="${r.confirmer}"><span>Valider chaque coup</span><i class="sw${r.confirmer ? ' on' : ''}"></i></button>
      <button class="gros" data-act="jouer"${erreurMoteur === 'wasm' ? ' disabled' : ''}>Jouer</button>
      <div class="bas">
        ${enCours ? `<button class="second" data-act="reprendre">Reprendre<small>${enCours.n}×${enCours.n} · ${nomNiv(enCours.k)} · coup ${enCours.coups.length}</small></button>` : ''}
        ${nbHist ? `<button class="second" data-act="historique">Parties<small>${nbHist} jouée${nbHist > 1 ? 's' : ''}</small></button>` : ''}
      </div>
      ${erreurMoteur === 'wasm' ? '<p class="avert">Ce navigateur bloque le calcul dont le bot a besoin (le mode d\'isolement de l\'iPhone ?).</p>' : ''}
      ${!moteur.simd && moteur.wasm ? '<p class="avert">Mode compatible (téléphone ancien) : le bot et l\'analyse seront plus lents.</p>' : ''}
      ${erreurMoteur === 'autre' ? '<p class="avert">Le bot ne démarre pas.</p><div class="bas"><button class="second" data-act="redemarrer" style="align-items:center;min-height:56px">Réessayer</button><button class="second" data-act="diagnostic" style="align-items:center;min-height:56px">Diagnostic</button></div>' : ''}
    </div>`;
  }

  function carteJoueur(c, nom, sous, pris, actif, attente) {
    return `<div class="joueur${actif ? ' actif' : ''}">${pierre(c)}<span class="nom">${nom}<small>${sous}</small></span>
      <span class="etat">${attente ? '<i class="att"><i></i><i></i><i></i></i>' : ''}</span><span class="pris">${pris > 0 ? pierre(3 - c, 'mini') + pris : ''}</span></div>`;
  }

  function vueJeu() {
    const g = G.sit.g, bc = botCouleur();
    const jeu = G.phase === 'jeu', marq = G.phase === 'marquage', fini = G.phase === 'fini';
    const pris = (c) => (c === NOIR ? g.prisesBlanc : g.prisesNoir);
    const monTour = jeu && !G.pense && G.sit.trait === G.humain;
    let opts = { dernier: G.coups.length ? G.coups[G.coups.length - 1][1] : 0, ko: jeu ? g.ko : 0 };
    if (G.fantome != null && monTour) opts.fantome = { loc: G.fantome, pla: G.humain };
    let score = null;
    if (marq || (fini && !G.resultat.abandon)) {
      const f = FIN.scoreFinal(G.sit, Array.from(G.mortes));
      score = f; opts.zone = f.zone; opts.mortes = G.mortes;
    }
    const plateau = PL.svgPlateau(g, opts);
    let message = G.message || '';
    if (!message && jeu && !moteur.pret && !erreurMoteur) message = lenteur ? 'Le bot charge encore (12 Mo la 1re fois)… connexion lente ?' : 'Le bot se prépare…';
    if (!message && jeu && G.coups.length === 0 && monTour) message = 'Touchez une case pour jouer.';
    if (erreurMoteur && jeu) message = erreurMoteur === 'wasm' ? 'Ce navigateur bloque le calcul du bot (mode d\'isolement ?).' : 'Le bot ne démarre pas. Touchez « Diagnostic » pour savoir pourquoi.';
    let actions = '';
    if (jeu) {
      actions = `<button class="act" data-act="passer"${monTour ? '' : ' disabled'}>Passer</button>
        ${stock.reglages.confirmer ? `<button class="act plein" data-act="poser"${monTour && G.fantome != null ? '' : ' disabled'}>Jouer</button>` : ''}
        <button class="act" data-act="abandon"${G.coups.length || monTour ? '' : ' disabled'}>Abandonner</button>`;
      if (G.erreurBot) actions = `<button class="act plein" data-act="reessayer">Réessayer</button><button class="act" data-act="abandon">Abandonner</button>`;
      if (erreurMoteur === 'autre') actions = `<button class="act plein" data-act="redemarrer">Réessayer</button><button class="act" data-act="diagnostic">Diagnostic</button><button class="act" data-act="abandon">Abandonner</button>`;
    } else if (marq) {
      actions = `<button class="act" data-act="continuer">Continuer à jouer</button><button class="act plein" data-act="valider">Valider</button>`;
    }
    let cartes, bas = '';
    if (marq || fini) {
      const detail = score ? `Noir ${score.noir} · Blanc ${score.blanc} + ${fr(G.komi)} (komi)` : '';
      const titre = fini ? texteResultat(G.resultat) : (score.diff > 0 ? 'Blanc devant de ' + pts(score.diff) : 'Noir devant de ' + pts(-score.diff));
      cartes = `<div class="score"><b>${titre}</b><small>${detail}</small></div>`;
    } else {
      cartes = '';
    }
    if (fini) {
      const a = G.analyse || { etat: 'rien', progres: 0 };
      if (a.etat === 'calcul') bas = `<div class="analyse"><div class="barre-prog"><i id="prog" style="width:${Math.round(a.progres * 100)}%"></i></div><p id="progTxt">Analyse en cours… ${Math.round(a.progres * 100)} %</p></div>`;
      else if (a.etat === 'pret') bas = `<button class="gros" data-act="voir-analyse">Voir l'analyse</button>`;
      else if (a.etat === 'rien') bas = `<p class="note">Partie trop courte pour être analysée.</p>`;
      else bas = `<button class="gros" data-act="relancer-analyse">Relancer l'analyse</button>`;
      bas += `<button class="second centre-b" data-act="menu">Menu</button>`;
    }
    const haut = !(marq || fini) ? carteJoueur(bc, 'Bot', nomNiv(G.k), pris(bc), jeu && G.sit.trait === bc, G.pense) : '';
    const moi = !(marq || fini) ? carteJoueur(G.humain, 'Vous', coul(G.humain), pris(G.humain), jeu && G.sit.trait === G.humain, false) : '';
    return `<div class="jeu">
      <div class="barre"><button class="retour" data-act="menu" aria-label="Menu">${IC.retour}</button><span class="titre-b">${G.n}×${G.n} · ${nomNiv(G.k)}</span><span class="cale"></span></div>
      <div class="zone">
        ${haut}
        <div class="centre"><div id="plateau" class="plateau">${plateau}</div></div>
        ${moi}${cartes}
      </div>
      <p class="message${message ? '' : ' vide'}" id="message">${echap(message) || '&nbsp;'}</p>
      ${bas || `<div class="actions${stock.reglages.confirmer && jeu ? ' trois' : ''}">${actions}</div>`}
      ${G.confirmeAbandon ? `<div class="voile"><div class="feuille"><p>Abandonner la partie ?</p><div class="actions"><button class="act" data-act="abandon-non">Non</button><button class="act plein" data-act="abandon-oui">Oui</button></div></div></div>` : ''}
    </div>`;
  }

  function texteResultat(r) {
    if (!r) return '';
    const moi = G && G.humain === r.gagnant;
    if (r.abandon) return moi ? 'Le bot a abandonné' : 'Vous avez abandonné';
    return (moi ? 'Vous gagnez de ' : 'Le bot gagne de ') + pts(Math.abs(r.diff));
  }
  function texteResultatEntree(e) {
    const r = e.resultat, moi = e.humain === r.gagnant;
    if (r.abandon) return moi ? 'Le bot a abandonné' : 'Vous avez abandonné';
    return (moi ? 'Victoire de ' : 'Défaite de ') + pts(Math.abs(r.diff));
  }

  /* ---------- revue ---------- */
  function infoCoup(i) {
    if (i < 0) return null;
    return R.infos[i];
  }
  function vueRevue() {
    const e = R.entree;
    const ong = R.onglet;
    return `<div class="revue">
      <div class="barre"><button class="retour" data-act="quitter-revue" aria-label="Retour">${IC.retour}</button>
        <div class="seg petit">${['resume', 'revue'].map((o) => `<button class="seg-b${ong === o ? ' on' : ''}" data-act="onglet" data-v="${o}">${o === 'resume' ? 'Résumé' : 'Coups'}</button>`).join('')}</div><span class="cale"></span></div>
      ${ong === 'resume' ? vueResume() : vueCoups()}
    </div>`;
  }
  function blocCourbe(avecCurseur) {
    const T = R.gains.length - 1;
    let pts_ = '';
    for (const d of R.infos) {
      if (!MAUVAIS[d.classe]) continue;
      const p = R.gains[d.i + 1];
      pts_ += `<i class="c-pt ${d.classe}" style="left:${(d.i + 1) / T * 100}%;top:${(4 + (1 - p) * 76) / 84 * 100}%"></i>`;
    }
    const cur = avecCurseur ? `<i class="c-cur" style="left:${R.cur / T * 100}%"></i>` : '';
    return `<div class="courbe-wrap" data-act="courbe">${PL.svgCourbe(R.gains)}${pts_}${cur}<span class="c-l haut">${pierre(NOIR)}</span><span class="c-l bas">${pierre(BLANC)}</span></div>`;
  }
  function vueResume() {
    const e = R.entree, J = R.joueurs;
    const nom = (c) => (c === R.humain ? 'Vous' : 'Bot');
    const col = (c, j) => `<div class="col">${pierre(c)}<b>${nom(c)}</b><small>${c === R.humain ? coul(c) : nomNiv(R.k)}</small><span class="grand">${Math.round(j.precision)}</span><small>précision</small></div>`;
    const lignes = ORDRE.map((cl) => {
      const a = J.noir.classes[cl] || 0, b = J.blanc.classes[cl] || 0;
      return `<div class="lig${a + b === 0 ? ' zero' : ''}">${PL.pastille(cl, 24)}<span class="lib">${AN.NOMS[cl]}</span><span class="n">${a}</span><span class="n">${b}</span></div>`;
    }).join('');
    return `<div class="resume">
      <p class="res-t">${echap(texteResultatEntree(e))}</p>
      <p class="res-s">${e.resultat.abandon ? 'par abandon' : 'Noir ' + e.resultat.noir + ' · Blanc ' + e.resultat.blanc + ' + ' + fr(e.komi) + ' (komi)'}</p>
      <div class="deux">${col(NOIR, J.noir)}${col(BLANC, J.blanc)}</div>
      <div class="perte"><span>Perte moyenne par coup</span><b>${fr(J.noir.perteMoyenne)}</b><b>${fr(J.blanc.perteMoyenne)}</b></div>
      ${blocCourbe(false)}
      <div class="liste">${lignes}</div>
      <button class="gros" data-act="onglet" data-v="revue">Revoir la partie</button>
      <p class="note">L'analyse est faite par le réseau KataGo sur ton téléphone ; elle reste approximative.</p>
    </div>`;
  }
  function vueCoups() {
    const g = R.sits[R.cur].g, d = infoCoup(R.cur - 1), T = R.coups.length;
    const opts = { dernier: R.cur ? R.coups[R.cur - 1][1] : 0 };
    if (d) {
      opts.badge = { loc: d.loc, cl: d.classe };
      if (d.meilleurLoc && d.meilleurLoc !== d.loc && d.meilleurLoc !== PASSE && g.c[d.meilleurLoc] === VIDE) opts.meilleur = d.meilleurLoc;
    }
    let carte;
    if (!d) carte = `<div class="carte-c"><b>Début de la partie</b><small>${R.n}×${R.n} · ${R.entree.komi} de komi</small></div>`;
    else {
      const q = PL.nomCase(R.n, g, d.loc);
      const quoi = d.loc === PASSE ? 'Passe' : q;
      const perte = d.perte >= 0.1 ? `−${pts(d.perte)}` : 'Aucune perte';
      const gv = (p) => Math.round(p * 100);
      const meil = d.meilleurLoc && d.meilleurLoc !== d.loc ? `<small>Meilleur coup : <b>${d.meilleurLoc === PASSE ? 'passer' : PL.nomCase(R.n, g, d.meilleurLoc)}</b></small>` : '';
      carte = `<div class="carte-c"><div class="cl">${PL.pastille(d.classe, 30)}<b>${AN.NOMS[d.classe]}</b></div>
        <small>Coup ${R.cur} · ${coul(d.joueur)} · ${quoi}</small>
        <small>${perte} · victoire ${gv(d.gainAvant)} % → ${gv(d.gainApres)} %</small>${meil}</div>`;
    }
    const mauvais = (i) => R.infos[i] && MAUVAIS[R.infos[i].classe];
    let precM = false, suivM = false;
    for (let i = 0; i < R.cur - 1; i++) if (mauvais(i)) precM = true;
    for (let i = R.cur; i < T; i++) if (mauvais(i)) suivM = true;
    return `<div class="coups">
      <div class="centre"><div id="plateau" class="plateau">${PL.svgPlateau(g, opts)}</div></div>
      ${carte}
      <div class="nav">
        <button class="nb" data-act="aller" data-v="0"${R.cur === 0 ? ' disabled' : ''} aria-label="Début">${IC.debut}</button>
        <button class="nb" data-act="aller" data-v="${R.cur - 1}"${R.cur === 0 ? ' disabled' : ''} aria-label="Coup précédent">${IC.prec}</button>
        <button class="nb" data-act="aller" data-v="${R.cur + 1}"${R.cur === T ? ' disabled' : ''} aria-label="Coup suivant">${IC.suiv}</button>
        <button class="nb" data-act="aller" data-v="${T}"${R.cur === T ? ' disabled' : ''} aria-label="Fin">${IC.fin}</button>
      </div>
      <div class="nav deux-p">
        <button class="pilule" data-act="erreur-prec"${precM ? '' : ' disabled'}>${IC.prec}Erreur</button>
        <button class="pilule" data-act="erreur-suiv"${suivM ? '' : ' disabled'}>Erreur${IC.suiv}</button>
      </div>
      ${blocCourbe(true)}
    </div>`;
  }

  function vueHistorique() {
    const items = stock.historique.map((e) => {
      const d = new Date(e.date), date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const prec = e.analyse ? Math.round(e.analyse.j[e.humain === NOIR ? 'noir' : 'blanc'].precision) + ' % de précision' : 'pas encore analysée';
      const sur = confirmeSuppr === e.id;
      return `<div class="hist"><button class="hist-c" data-act="ouvrir" data-v="${e.id}">
          <span class="h1">${e.n}×${e.n} · ${nomNiv(e.k)} · ${pierre(e.humain)}</span>
          <span class="h2">${echap(texteResultatEntree(e))} · ${prec}</span><span class="h3">${date}</span></button>
        <button class="hist-x${sur ? ' sur' : ''}" data-act="suppr" data-v="${e.id}" aria-label="Supprimer">${sur ? IC.ok : IC.poubelle}</button></div>`;
    }).join('');
    return `<div class="hist-page"><div class="barre"><button class="retour" data-act="menu" aria-label="Menu">${IC.retour}</button><span class="titre-b">Parties</span><span class="cale"></span></div>
      ${items || '<p class="note">Aucune partie pour l\'instant.</p>'}</div>`;
  }

  function rendre() {
    const el = racine();
    if (!el) return;
    el.innerHTML = ecran === 'menu' ? vueMenu() : ecran === 'jeu' ? (G ? vueJeu() : vueMenu()) : ecran === 'revue' ? vueRevue() : vueHistorique();
  }

  /* ---------- actions ---------- */
  function lancerPartie() {
    const r = stock.reglages;
    let humain = r.couleur === 'noir' ? NOIR : r.couleur === 'blanc' ? BLANC : (Math.random() < 0.5 ? NOIR : BLANC);
    moteur.annulerAnalyse();
    G = nouvellePartie(r.taille, r.niveau, humain);
    ecran = 'jeu'; ecrire(); sauverPartie(); rendre();
    demanderBot();
  }
  function reprendre() {
    if (!stock.enCours) return;
    moteur.annulerAnalyse();
    G = restaurer(stock.enCours);
    ecran = 'jeu';
    if (G.phase === 'marquage') { G.message = 'Touchez un groupe pour le déclarer mort ou vivant.'; rendre(); if (!G.mortes.size) debutMarquage(); }
    else { rendre(); demanderBot(); }
  }
  function versMenu() {
    if (G && G.phase !== 'fini') { ++reqId; G.pense = false; sauverPartie(); G = null; }
    ecran = 'menu'; R = null; rendre(); window.scrollTo(0, 0);
  }
  function majNiveau(k, depuisCurseur) {
    k = Math.max(-9, Math.min(30, k));
    stock.reglages.niveau = k; ecrire();
    const nom = document.getElementById('nivNom'), cur = document.getElementById('nivRange');
    if (nom) nom.textContent = nomNiv(k);
    if (cur && !depuisCurseur) cur.value = idxDepuisK(k);
  }

  function clic(e) {
    const sv = e.target.closest && e.target.closest('#plateau svg.goban');
    if (sv && ecran === 'jeu' && G) {
      const loc = PL.caseSous(sv, G.sit.g, e.clientX, e.clientY);
      if (!loc) return;
      if (G.phase === 'jeu') {
        if (G.pense || G.sit.trait !== G.humain) return;
        if (!G.sit.estLegal(loc, G.humain)) { G.fantome = null; G.message = raisonInterdit(G.sit, loc, G.humain); rendre(); return; }
        if (!stock.reglages.confirmer || G.fantome === loc) jouerHumain(loc);
        else { G.fantome = loc; G.message = ''; rendre(); }
      } else if (G.phase === 'marquage') basculerGroupe(loc);
      return;
    }
    const courbe = e.target.closest && e.target.closest('.courbe-wrap');
    if (courbe && R) {
      const r = courbe.getBoundingClientRect(), T = R.coups.length;
      const i = Math.max(0, Math.min(T, Math.round((e.clientX - r.left) / r.width * T)));
      R.cur = i; R.onglet = 'revue'; rendre(); return;
    }
    const b = e.target.closest && e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act, v = b.dataset.v;
    switch (act) {
      case 'taille': stock.reglages.taille = +v; ecrire(); rendre(); break;
      case 'couleur': stock.reglages.couleur = v; ecrire(); rendre(); break;
      case 'confirmer': stock.reglages.confirmer = !stock.reglages.confirmer; ecrire(); rendre(); break;
      case 'niv-': majNiveau(stock.reglages.niveau + 1); break;
      case 'niv+': majNiveau(stock.reglages.niveau - 1); break;
      case 'jouer': lancerPartie(); break;
      case 'reprendre': reprendre(); break;
      case 'historique': ecran = 'historique'; confirmeSuppr = null; rendre(); break;
      case 'menu': versMenu(); break;
      case 'passer': jouerHumain(PASSE); break;
      case 'poser': if (G && G.fantome != null) jouerHumain(G.fantome); break;
      case 'abandon': if (G) { G.confirmeAbandon = true; rendre(); } break;
      case 'abandon-non': G.confirmeAbandon = false; rendre(); break;
      case 'abandon-oui': abandonner(); break;
      case 'reessayer': G.erreurBot = false; G.message = ''; demanderBot(); break;
      case 'redemarrer':
        moteur.redemarrer(); surveillerMoteur();
        if (G) { G.erreurBot = false; G.pense = false; G.message = ''; }
        rendre(); if (G) demanderBot(); break;
      case 'diagnostic': location.href = 'diagnostic.html'; break;
      case 'continuer': continuerAJouer(); break;
      case 'valider': valider(); break;
      case 'voir-analyse': if (G && G.entree && G.entree.analyse) { origineRevue = 'jeu'; ouvrirRevue(G.entree, 'resume'); } break;
      case 'relancer-analyse': if (G && G.entree) { lancerAnalyse(G); rendre(); } break;
      case 'quitter-revue': R = null; ecran = (origineRevue === 'jeu' && G) ? 'jeu' : 'historique'; rendre(); break;
      case 'onglet': R.onglet = v; rendre(); window.scrollTo(0, 0); break;
      case 'aller': R.cur = Math.max(0, Math.min(R.coups.length, +v)); rendre(); break;
      case 'erreur-prec': for (let i = R.cur - 2; i >= 0; i--) if (MAUVAIS[R.infos[i].classe]) { R.cur = i + 1; break; } rendre(); break;
      case 'erreur-suiv': for (let i = R.cur; i < R.coups.length; i++) if (MAUVAIS[R.infos[i].classe]) { R.cur = i + 1; break; } rendre(); break;
      case 'ouvrir': {
        const ent = stock.historique.find((x) => x.id === +v);
        if (!ent) break;
        origineRevue = 'historique';
        if (ent.analyse) ouvrirRevue(ent, 'resume');
        else ouvrirHistoriqueSansAnalyse(ent);
        break;
      }
      case 'suppr':
        if (confirmeSuppr === +v) { stock.historique = stock.historique.filter((x) => x.id !== +v); confirmeSuppr = null; ecrire(); }
        else confirmeSuppr = +v;
        rendre(); break;
    }
  }
  function ouvrirHistoriqueSansAnalyse(ent) {
    // reprend l'écran de fin de partie pour lancer l'analyse
    const g = nouvellePartie(ent.n, ent.k, ent.humain);
    g.id = ent.id; g.date = ent.date;
    for (const c of ent.coups) { g.coups.push([c[0], c[1]]); g.sit = g.sit.jouer(c[1], c[0], true); }
    g.phase = 'fini'; g.resultat = ent.resultat; g.entree = ent; g.mortes = new Set(ent.mortes || []);
    G = g; ecran = 'jeu'; lancerAnalyse(g); rendre();
  }

  document.addEventListener('click', clic);
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'nivRange') majNiveau(kDepuisIdx(+e.target.value), true);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { sauverPartie(); } });
  window.addEventListener('pagehide', () => { sauverPartie(); });

  // pour les tests
  window.GoApp = { get G() { return G; }, get R() { return R; }, get stock() { return stock; }, moteur, rendre, lancerPartie };

  rendre();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
