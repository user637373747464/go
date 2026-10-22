// goban.js — plateau de go : pierres, chaînes, libertés, coups, annulation, échelles, zones « passe-vivantes ».
// C'est une traduction de la logique de KataGo (game/board.cpp) : le réseau de neurones attend exactement
// les mêmes « yeux » que ceux de KataGo, donc on garde ses conventions (position d'une case, ordre de parcours…).
// Position d'une case (x, y) : (x + 1) + (y + 1) * (n + 1). Le mur de droite d'une ligne sert aussi de mur de gauche à la suivante.
(function (racine, usine) {
  if (typeof module === 'object' && module.exports) module.exports = usine();
  else racine.GoGoban = usine();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VIDE = 0, NOIR = 1, BLANC = 2, MUR = 3;
  const NUL = 0, PASSE = 1;

  // ---- empreintes de Zobrist (pour reconnaître une position déjà vue : super-ko) ----
  const ZMAX = 21 * 22 + 1;
  const ZA = new Int32Array(ZMAX * 3), ZB = new Int32Array(ZMAX * 3);
  (function () {
    let s = 0x2545f491 | 0;
    const suivant = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; };
    for (let i = 0; i < ZA.length; i++) { ZA[i] = suivant(); ZB[i] = suivant(); }
  })();

  class Goban {
    constructor(n) {
      this.n = n;
      this.l = n + 1;
      const taille = (n + 1) * (n + 2) + 1;
      this.taille = taille;
      this.c = new Uint8Array(taille).fill(MUR);
      this.tete = new Int16Array(taille);
      this.suiv = new Int16Array(taille);
      this.nPierres = new Int16Array(taille);
      this.nLibs = new Int16Array(taille);
      this.ko = NUL;
      this.h1 = 0; this.h2 = 0;
      this.prisesNoir = 0; this.prisesBlanc = 0;   // pierres blanches / noires capturées (compteurs)
      this.adj = [-(n + 1), -1, 1, n + 1];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) this.c[(x + 1) + (y + 1) * (n + 1)] = VIDE;
      this._vus = new Int16Array(4);
      this._ech = null;
    }

    cloner() {
      const g = Object.create(Goban.prototype);
      g.n = this.n; g.l = this.l; g.taille = this.taille;
      g.c = this.c.slice(); g.tete = this.tete.slice(); g.suiv = this.suiv.slice();
      g.nPierres = this.nPierres.slice(); g.nLibs = this.nLibs.slice();
      g.ko = this.ko; g.h1 = this.h1; g.h2 = this.h2;
      g.prisesNoir = this.prisesNoir; g.prisesBlanc = this.prisesBlanc;
      g.adj = this.adj; g._vus = new Int16Array(4); g._ech = null;
      return g;
    }

    loc(x, y) { return (x + 1) + (y + 1) * this.l; }
    x(loc) { return (loc % this.l) - 1; }
    y(loc) { return ((loc / this.l) | 0) - 1; }

    cle() { return (this.h1 >>> 0) * 2097152 + (this.h2 >>> 11); }

    _xor(loc, col) { const k = loc * 3 + (col - 1); this.h1 ^= ZA[k]; this.h2 ^= ZB[k]; }

    libsImmediates(loc) {
      const c = this.c, a = this.adj;
      let k = 0;
      if (c[loc + a[0]] === VIDE) k++;
      if (c[loc + a[1]] === VIDE) k++;
      if (c[loc + a[2]] === VIDE) k++;
      if (c[loc + a[3]] === VIDE) k++;
      return k;
    }

    libs(loc) { return this.nLibs[this.tete[loc]]; }
    taillChaine(loc) { return this.nPierres[this.tete[loc]]; }

    // ---------- légalité (hors super-ko, voir Partie) ----------
    estSuicide(loc, pla) {
      const c = this.c, a = this.adj, opp = 3 - pla;
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i], cv = c[v];
        if (cv === VIDE) return false;
        if (cv === pla) { if (this.nLibs[this.tete[v]] > 1) return false; }
        else if (cv === opp) { if (this.nLibs[this.tete[v]] === 1) return false; }
      }
      return true;
    }

    estSuicideInterdit(loc, pla, suicideMultiPermis) {
      const c = this.c, a = this.adj, opp = 3 - pla;
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i], cv = c[v];
        if (cv === VIDE) return false;
        if (cv === pla) { if (suicideMultiPermis || this.nLibs[this.tete[v]] > 1) return false; }
        else if (cv === opp) { if (this.nLibs[this.tete[v]] === 1) return false; }
      }
      return true;
    }

    estLegal(loc, pla, suicideMultiPermis) {
      if (pla !== NOIR && pla !== BLANC) return false;
      if (loc === PASSE) return true;
      return loc > 1 && loc < this.taille && this.c[loc] === VIDE && loc !== this.ko && !this.estSuicideInterdit(loc, pla, !!suicideMultiPermis);
    }

    estLegalSansKo(loc, pla, suicideMultiPermis) {
      if (pla !== NOIR && pla !== BLANC) return false;
      if (loc === PASSE) return true;
      return loc > 1 && loc < this.taille && this.c[loc] === VIDE && !this.estSuicideInterdit(loc, pla, !!suicideMultiPermis);
    }

    // prise de ko simple possible ? (la case est entourée de pierres adverses/murs dont une seule capturable, d'une pierre)
    coupDeKo(loc, pla) {
      const c = this.c, a = this.adj, opp = 3 - pla;
      if (c[loc] !== VIDE) return false;
      let cap = NUL;
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i];
        if (c[v] !== MUR && c[v] !== opp) return false;
        if (c[v] === opp && this.nLibs[this.tete[v]] === 1) { if (cap !== NUL) return false; cap = v; }
      }
      if (cap === NUL) return false;
      return this.nPierres[this.tete[cap]] === 1;
    }

    bornesLibertesApres(loc, pla) {
      const c = this.c, a = this.adj, opp = 3 - pla;
      let immediates = 0, nCaps = 0, potentielCaps = 0, libsConn = 0, maxConn = 0;
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i], cv = c[v];
        if (cv === VIDE) immediates++;
        else if (cv === opp) {
          const h = this.tete[v];
          if (this.nLibs[h] === 1) { nCaps++; potentielCaps += this.nPierres[h]; }
        } else if (cv === pla) {
          const cl = this.nLibs[this.tete[v]] - 1;
          libsConn += cl;
          if (cl > maxConn) maxConn = cl;
        }
      }
      this._bas = nCaps + (maxConn > immediates ? maxConn : immediates);
      this._haut = immediates + potentielCaps + libsConn;
    }

    libertesApres(loc, pla, max) {
      const c = this.c, a = this.adj, opp = 3 - pla;
      let nLibs = 0;
      const libs = [];
      const capt = [];
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i];
        if (c[v] === VIDE) {
          libs[nLibs++] = v;
          if (nLibs >= max) return max;
        } else if (c[v] === opp && this.nLibs[this.tete[v]] === 1) {
          libs[nLibs++] = v;
          if (nLibs >= max) return max;
          const h = this.tete[v];
          if (capt.indexOf(h) < 0) capt.push(h);
        }
      }
      const seraVide = (lc) => {
        if (c[lc] === VIDE) return true;
        if (c[lc] === opp && capt.indexOf(this.tete[lc]) >= 0) return true;
        return false;
      };
      const connectes = [];
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i];
        if (c[v] === pla) {
          const h = this.tete[v];
          if (connectes.indexOf(h) >= 0) continue;
          connectes.push(h);
          let cur = v;
          do {
            for (let k = 0; k < 4; k++) {
              const pl = cur + a[k];
              if (pl !== loc && seraVide(pl)) {
                if (libs.indexOf(pl) < 0) {
                  libs[nLibs++] = pl;
                  if (nLibs >= max) return max;
                }
              }
            }
            cur = this.suiv[cur];
          } while (cur !== v);
        }
      }
      return nLibs;
    }

    // ---------- jouer un coup (suppose légal) ----------
    jouer(loc, pla) {
      if (loc === PASSE) { this.ko = NUL; return; }
      const c = this.c, tete = this.tete, suiv = this.suiv, nPierres = this.nPierres, nLibs = this.nLibs, a = this.adj;
      const opp = 3 - pla;
      c[loc] = pla; this._xor(loc, pla);
      nPierres[loc] = 1; nLibs[loc] = this.libsImmediates(loc); tete[loc] = loc; suiv[loc] = loc;
      let nCapt = 0, koPossible = NUL, nVus = 0;
      const vus = this._vus;
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i];
        if (c[v] === pla) {
          if (tete[v] === tete[loc]) continue;
          nLibs[tete[v]]--;
          this.fusionner(v, loc);
        } else if (c[v] === opp) {
          const th = tete[v];
          let vu = false;
          for (let j = 0; j < nVus; j++) if (vus[j] === th) { vu = true; break; }
          if (vu) continue;
          nLibs[th]--;
          vus[nVus++] = th;
          if (nLibs[tete[v]] === 0) { nCapt += this.retirerChaine(v); koPossible = v; }
        }
      }
      if (nCapt === 1 && nPierres[tete[loc]] === 1 && nLibs[tete[loc]] === 1) this.ko = koPossible; else this.ko = NUL;
      if (pla === NOIR) this.prisesBlanc += nCapt; else this.prisesNoir += nCapt;
      if (nLibs[tete[loc]] === 0) {
        const nSuicide = nPierres[tete[loc]];
        this.retirerChaine(loc);
        if (pla === NOIR) this.prisesNoir += nSuicide; else this.prisesBlanc += nSuicide;
      }
    }

    // jouer en gardant de quoi annuler
    jouerEnreg(loc, pla) {
      const rec = { loc, pla, ko: this.ko, cap: 0 };
      if (loc !== PASSE) {
        const c = this.c, a = this.adj, opp = 3 - pla;
        for (let i = 0; i < 4; i++) {
          const v = loc + a[i];
          if (c[v] === opp && this.nLibs[this.tete[v]] === 1) rec.cap |= (1 << i);
        }
        if (rec.cap === 0 && this.estSuicide(loc, pla)) rec.cap = 0x10;
      }
      this.jouer(loc, pla);
      return rec;
    }

    defaire(rec) {
      this.ko = rec.ko;
      const loc = rec.loc;
      if (loc === PASSE) return;
      const c = this.c, a = this.adj, tete = this.tete, suiv = this.suiv, nPierres = this.nPierres, nLibs = this.nLibs;
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i];
        if (rec.cap & (1 << i)) {
          if (c[v] === VIDE) {
            this.ajouterChaine(v, 3 - rec.pla);
            const n = nPierres[tete[v]];
            if (rec.pla === NOIR) this.prisesBlanc -= n; else this.prisesNoir -= n;
          }
        }
      }
      if (rec.cap === 0x10) {
        this.ajouterChaine(loc, rec.pla);
        const n = nPierres[tete[loc]];
        if (rec.pla === NOIR) this.prisesNoir -= n; else this.prisesBlanc -= n;
      }
      this._xor(loc, c[loc]);
      c[loc] = VIDE;
      this.changerLibsAutour(loc, 3 - rec.pla, +1);
      if (nPierres[tete[loc]] > 1) {
        let nVoisins = 0;
        for (let i = 0; i < 4; i++) if (c[loc + a[i]] === rec.pla) nVoisins++;
        if (nVoisins <= 1) {
          let head = tete[loc];
          if (head === loc) {
            const nouvelle = suiv[loc];
            let cur = loc;
            do { tete[cur] = nouvelle; cur = suiv[cur]; } while (cur !== loc);
            nPierres[nouvelle] = nPierres[head];
            nLibs[nouvelle] = nLibs[head];
            head = nouvelle;
          }
          {
            let cur = head;
            while (suiv[cur] !== loc) cur = suiv[cur];
            suiv[cur] = suiv[loc];
          }
          let delta = 0;
          for (let i = 0; i < 4; i++) {
            const v = loc + a[i];
            if (c[v] === VIDE && !this.estLibertéDe(v, head)) delta--;
          }
          delta++;
          nLibs[head] += delta;
          nPierres[head]--;
        } else {
          let cur = loc;
          do { tete[cur] = NUL; cur = suiv[cur]; } while (cur !== loc);
          for (let i = 0; i < 4; i++) {
            const v = loc + a[i];
            if (c[v] === rec.pla && tete[v] === NUL) this.reconstruireChaine(v, rec.pla);
          }
        }
      }
    }

    estLibertéDe(loc, head) {
      const c = this.c, a = this.adj, tete = this.tete, col = c[head];
      for (let i = 0; i < 4; i++) { const v = loc + a[i]; if (c[v] === col && tete[v] === head) return true; }
      return false;
    }

    fusionner(loc1, loc2) {
      const tete = this.tete, suiv = this.suiv, nPierres = this.nPierres, nLibs = this.nLibs, c = this.c, a = this.adj;
      let head1 = tete[loc1], head2 = tete[loc2];
      if (nPierres[head1] < nPierres[head2]) { const t = head1; head1 = head2; head2 = t; }
      nPierres[head1] += nPierres[head2];
      let nouvelles = 0;
      let loc = head2;
      while (true) {
        for (let i = 0; i < 4; i++) {
          const v = loc + a[i];
          if (c[v] === VIDE && !this.estLibertéDe(v, head1)) nouvelles++;
        }
        tete[loc] = head1;
        if (suiv[loc] !== head2) loc = suiv[loc]; else break;
      }
      nLibs[head1] += nouvelles;
      suiv[loc] = suiv[head1];
      suiv[head1] = head2;
    }

    retirerChaine(loc) {
      const c = this.c, suiv = this.suiv;
      const opp = 3 - c[loc];
      let n = 0, cur = loc;
      do {
        this._xor(cur, c[cur]);
        c[cur] = VIDE;
        n++;
        this.changerLibsAutour(cur, opp, +1);
        cur = suiv[cur];
      } while (cur !== loc);
      return n;
    }

    changerLibsAutour(loc, pla, delta) {
      const c = this.c, tete = this.tete, nLibs = this.nLibs, a = this.adj;
      const a0 = loc + a[0], a1 = loc + a[1], a2 = loc + a[2], a3 = loc + a[3];
      if (c[a0] === pla) nLibs[tete[a0]] += delta;
      if (c[a1] === pla && !(c[a0] === pla && tete[a0] === tete[a1])) nLibs[tete[a1]] += delta;
      if (c[a2] === pla && !(c[a0] === pla && tete[a0] === tete[a2]) && !(c[a1] === pla && tete[a1] === tete[a2])) nLibs[tete[a2]] += delta;
      if (c[a3] === pla && !(c[a0] === pla && tete[a0] === tete[a3]) && !(c[a1] === pla && tete[a1] === tete[a3]) && !(c[a2] === pla && tete[a2] === tete[a3])) nLibs[tete[a3]] += delta;
    }

    ajouterChaine(loc, pla) {
      this.nLibs[loc] = 0; this.nPierres[loc] = 0;
      const front = this.ajouterChaineAide(loc, loc, loc, pla);
      this.suiv[loc] = front;
    }

    ajouterChaineAide(head, tailTarget, loc, pla) {
      const c = this.c, a = this.adj;
      c[loc] = pla; this._xor(loc, pla);
      this.tete[loc] = head;
      this.nPierres[head]++;
      this.suiv[loc] = tailTarget;
      this.changerLibsAutour(loc, 3 - pla, -1);
      let nextTail = loc;
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i];
        if (c[v] === VIDE) nextTail = this.ajouterChaineAide(head, nextTail, v, pla);
      }
      return nextTail;
    }

    reconstruireChaine(loc, pla) {
      this.nLibs[loc] = 0; this.nPierres[loc] = 0;
      const front = this.reconstruireChaineAide(loc, loc, loc, pla);
      this.suiv[loc] = front;
    }

    reconstruireChaineAide(head, tailTarget, loc, pla) {
      const c = this.c, a = this.adj, tete = this.tete;
      let ajout = 0;
      for (let i = 0; i < 4; i++) { const v = loc + a[i]; if (c[v] === VIDE && !this.estLibertéDe(v, head)) ajout++; }
      this.nLibs[head] += ajout;
      tete[loc] = head;
      this.nPierres[head]++;
      this.suiv[loc] = tailTarget;
      let nextTail = loc;
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i];
        if (c[v] === pla && tete[v] !== head) nextTail = this.reconstruireChaineAide(head, nextTail, v, pla);
      }
      return nextTail;
    }

    // empreinte de la position après un coup (sans le jouer) : sert au super-ko. Résultat dans this._r1/_r2.
    empreinteApres(loc, pla) {
      let h1 = this.h1, h2 = this.h2;
      if (loc === PASSE) { this._r1 = h1; this._r2 = h2; return; }
      const c = this.c, a = this.adj, opp = 3 - pla, tete = this.tete, suiv = this.suiv;
      let k = loc * 3 + (pla - 1);
      h1 ^= ZA[k]; h2 ^= ZB[k];
      let suicide = true;
      const capt = [];
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i], cv = c[v];
        if (cv === VIDE) suicide = false;
        else if (cv === pla && this.nLibs[tete[v]] > 1) suicide = false;
        else if (cv === opp) {
          if (this.nLibs[tete[v]] === 1) {
            const h = tete[v];
            if (capt.indexOf(h) < 0) {
              capt.push(h);
              suicide = false;
              let cur = v;
              do { k = cur * 3 + (opp - 1); h1 ^= ZA[k]; h2 ^= ZB[k]; cur = suiv[cur]; } while (cur !== v);
            }
          }
        }
      }
      if (suicide) {
        const capt2 = [];
        for (let i = 0; i < 4; i++) {
          const v = loc + a[i];
          if (c[v] === pla && this.nLibs[tete[v]] === 1) {
            const h = tete[v];
            if (capt2.indexOf(h) < 0) {
              capt2.push(h);
              let cur = v;
              do { k = cur * 3 + (pla - 1); h1 ^= ZA[k]; h2 ^= ZB[k]; cur = suiv[cur]; } while (cur !== v);
            }
          }
        }
        k = loc * 3 + (pla - 1);
        h1 ^= ZA[k]; h2 ^= ZB[k];
      }
      this._r1 = h1; this._r2 = h2;
    }

    // ---------- outils tactiques (échelles) ----------
    trouverLibertes(loc, buf, debut, idx) {
      const c = this.c, a = this.adj, suiv = this.suiv;
      let n = 0, cur = loc;
      do {
        for (let i = 0; i < 4; i++) {
          const lib = cur + a[i];
          if (c[lib] === VIDE) {
            let dup = false;
            for (let j = debut; j < idx + n; j++) if (buf[j] === lib) { dup = true; break; }
            if (!dup) { buf[idx + n] = lib; n++; }
          }
        }
        cur = suiv[cur];
      } while (cur !== loc);
      return n;
    }

    capturesQuiGagnentLibertes(loc, buf, debut, idx) {
      const c = this.c, a = this.adj, suiv = this.suiv, tete = this.tete;
      const opp = 3 - c[loc];
      const verifies = [];
      let n = 0, cur = loc;
      do {
        for (let i = 0; i < 4; i++) {
          const v = cur + a[i];
          if (c[v] === opp) {
            const h = tete[v];
            if (this.nLibs[h] === 1 && verifies.indexOf(h) < 0) {
              n += this.trouverLibertes(v, buf, debut, idx + n);
              verifies.push(h);
            }
          }
        }
        cur = suiv[cur];
      } while (cur !== loc);
      return n;
    }

    aCaptureQuiGagneLibertes(loc) {
      const c = this.c, a = this.adj, suiv = this.suiv, tete = this.tete;
      const opp = 3 - c[loc];
      let cur = loc;
      do {
        for (let i = 0; i < 4; i++) {
          const v = cur + a[i];
          if (c[v] === opp && this.nLibs[tete[v]] === 1) return true;
        }
        cur = suiv[cur];
      } while (cur !== loc);
      return false;
    }

    heuristiqueConnexionX2(loc, pla) {
      const c = this.c, a = this.adj;
      let r = 0;
      for (let i = 0; i < 4; i++) {
        const v = loc + a[i];
        if (c[v] === pla) { const l = this.nLibs[this.tete[v]]; if (l > 1) r += l * 2 - 3; }
      }
      return r;
    }

    estAdjacent(l0, l1) { return l0 === l1 - 1 || l0 === l1 + 1 || l0 === l1 - this.l || l0 === l1 + this.l; }

    // Le groupe en loc (2 libertés) est-il capturé en échelle si l'attaquant joue en premier ? Remplit travail avec les coups gagnants.
    echelle2Libs(loc, buf, travail) {
      if (loc < 0 || loc >= this.taille) return false;
      if (this.c[loc] !== NOIR && this.c[loc] !== BLANC) return false;
      if (this.nLibs[this.tete[loc]] !== 2) return false;
      const pla = this.c[loc], opp = 3 - pla;
      this.trouverLibertes(loc, buf, 0, 0);
      const m0 = buf[0], m1 = buf[1];
      let ok0 = false, ok1 = false;
      if (this.estLegal(m0, opp, false)) {
        const r = this.jouerEnreg(m0, opp);
        ok0 = this.echelleCapturee(loc, true, buf);
        this.defaire(r);
      }
      if (this.estLegal(m1, opp, false)) {
        const r = this.jouerEnreg(m1, opp);
        ok1 = this.echelleCapturee(loc, true, buf);
        this.defaire(r);
      }
      if (ok0 || ok1) {
        travail.length = 0;
        if (ok0) travail.push(m0);
        if (ok1) travail.push(m1);
        return true;
      }
      return false;
    }

    echelleCapturee(loc, defenseurDabord, buf) {
      if (loc < 0 || loc >= this.taille) return false;
      if (this.c[loc] !== NOIR && this.c[loc] !== BLANC) return false;
      if (this.nLibs[this.tete[loc]] > 2 || (defenseurDabord && this.nLibs[this.tete[loc]] > 1)) return false;
      const pla = this.c[loc], opp = 3 - pla;
      const koSauve = this.ko;
      if (defenseurDabord) this.ko = NUL;
      const tailleSt = this.n * this.n * 3 / 2 + 1 | 0;
      const debuts = new Int32Array(tailleSt + 2), longueurs = new Int32Array(tailleSt + 2), courants = new Int32Array(tailleSt + 2);
      const records = new Array(tailleSt + 2);
      let st = 0, noeuds = 0;
      const BUDGET = 25000;
      courants[0] = -1; debuts[0] = 0; longueurs[0] = 0;
      let retour = false, revient = false;
      while (true) {
        if (st <= -1) { this.ko = koSauve; return retour; }
        if (st >= tailleSt - 1) { retour = true; revient = true; st--; continue; }
        if (noeuds >= BUDGET) {
          st -= 1;
          while (st >= 0) { this.defaire(records[st]); st -= 1; }
          return false;
        }
        const estDef = (defenseurDabord && (st % 2) === 0) || (!defenseurDabord && (st % 2) === 1);
        if (courants[st] === -1) {
          const libs = this.nLibs[this.tete[loc]];
          if (!estDef && libs <= 1) { retour = true; revient = true; st--; continue; }
          if (!estDef && libs >= 3) { retour = false; revient = true; st--; continue; }
          if (estDef && libs >= 2) { retour = false; revient = true; st--; continue; }
          if (estDef && this.ko !== NUL) { retour = false; revient = true; st--; continue; }
          const debut = debuts[st];
          let lon = 0;
          if (estDef) {
            lon = this.capturesQuiGagnentLibertes(loc, buf, debut, debut);
            lon += this.trouverLibertes(loc, buf, debut, debut + lon);
            this.bornesLibertesApres(buf[debut + lon - 1], pla);
            const bas = this._bas, haut = this._haut;
            if (bas >= 3) { retour = false; revient = true; st--; continue; }
            if (lon === 1 && haut <= 1) { retour = true; revient = true; st--; continue; }
          } else {
            lon += this.trouverLibertes(loc, buf, debut, debut);
            let libs0 = this.libsImmediates(buf[debut]);
            let libs1 = this.libsImmediates(buf[debut + 1]);
            if (libs0 === 0 && libs1 === 0 && this.coupDeKo(buf[debut], opp) && this.coupDeKo(buf[debut + 1], opp)) {
              if (this.libertesApres(buf[debut], pla, 3) <= 2 && this.libertesApres(buf[debut + 1], pla, 3) <= 2) {
                if (!this.aCaptureQuiGagneLibertes(loc)) { retour = true; revient = true; st--; continue; }
              }
            }
            if (!this.estAdjacent(buf[debut], buf[debut + 1])) {
              if (libs0 >= 3 && libs1 >= 3) { retour = false; revient = true; st--; continue; }
              else if (libs0 >= 3) { lon = 1; }
              else if (libs1 >= 3) { buf[debut] = buf[debut + 1]; lon = 1; }
            }
            if (lon > 1) {
              libs0 = libs0 * 2 + this.heuristiqueConnexionX2(buf[debut], pla);
              libs1 = libs1 * 2 + this.heuristiqueConnexionX2(buf[debut + 1], pla);
              if (libs1 > libs0) { const t = buf[debut]; buf[debut] = buf[debut + 1]; buf[debut + 1] = t; }
            }
          }
          longueurs[st] = lon;
          courants[st] = 0;
        } else {
          if (revient) this.defaire(records[st]);
          if (estDef && !retour) { revient = true; st--; continue; }
          if (!estDef && retour) { revient = true; st--; continue; }
          courants[st]++;
        }
        if (courants[st] >= longueurs[st]) { retour = estDef; revient = true; st--; continue; }
        const coup = buf[debuts[st] + courants[st]];
        const p = estDef ? pla : opp;
        if (!this.estLegal(coup, p, false)) { retour = estDef; revient = false; continue; }
        records[st] = this.jouerEnreg(coup, p);
        noeuds++;
        st++;
        courants[st] = -1;
        debuts[st] = debuts[st - 1] + longueurs[st - 1];
        longueurs[st] = 0;
      }
    }

    // Liste des pierres « prises dans une échelle » : tableau de [loc, coupsQuiMarchent[]]. Calculé une fois par plateau.
    echelles() {
      if (this._ech) return this._ech;
      const res = [];
      const copie = this.cloner();
      const resolues = [], valeurs = [];
      const buf = [];
      let travail = [];
      const n = this.n, c = this.c;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const loc = (x + 1) + (y + 1) * this.l;
        const pierre = c[loc];
        if (pierre === NOIR || pierre === BLANC) {
          const libs = this.nLibs[this.tete[loc]];
          if (libs === 1 || libs === 2) {
            let deja = false;
            const head = this.tete[loc];
            for (let i = 0; i < resolues.length; i++) {
              if (resolues[i] === head) {
                deja = true;
                if (valeurs[i]) { travail = []; res.push([loc, travail]); }
                break;
              }
            }
            if (!deja) {
              let laddered;
              if (libs === 1) laddered = copie.echelleCapturee(loc, true, buf);
              else { travail = []; laddered = copie.echelle2Libs(loc, buf, travail); }
              resolues.push(head); valeurs.push(laddered);
              if (laddered) res.push([loc, travail.slice()]);
            }
          }
        }
      }
      this._ech = res;
      return res;
    }

    // ---------- zones passe-vivantes (algorithme de Benson, comme KataGo) ----------
    // résultat : Uint8Array (VIDE / NOIR / BLANC) ; nonPassVivantes = marquer toutes les pierres restantes comme leur couleur
    zone(nonPassVivantes, grandesSures, grandesIncertaines) {
      const res = new Uint8Array(this.taille);
      this._zonePour(NOIR, grandesSures, grandesIncertaines, res);
      this._zonePour(BLANC, grandesSures, grandesIncertaines, res);
      if (nonPassVivantes) {
        const n = this.n;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const loc = (x + 1) + (y + 1) * this.l;
          if (res[loc] === VIDE) res[loc] = this.c[loc];
        }
      }
      return res;
    }

    _zonePour(pla, grandesSures, grandesIncertaines, result) {
      const c = this.c, a = this.adj, tete = this.tete, suiv = this.suiv, taille = this.taille, n = this.n, l = this.l;
      const opp = 3 - pla;
      const regionDe = new Int16Array(taille).fill(-1);
      const suivante = new Int16Array(taille);
      const bordeMortePar = new Uint8Array(taille);
      const maxReg = ((n * n + 1) >> 1) + 2;
      const vitalList = new Int16Array(maxReg * 4 + 8);
      let vitalTotal = 0;
      let nReg = 0;
      const tetesReg = new Int16Array(maxReg);
      const vStart = new Uint16Array(maxReg), vLen = new Uint16Array(maxReg);
      const internes = new Uint8Array(maxReg), contientOpp = new Uint8Array(maxReg);
      const file = new Int16Array(taille);

      const adjacentATete = (loc, head) => {
        for (let i = 0; i < 4; i++) { const v = loc + a[i]; if (c[v] === pla && tete[v] === head) return true; }
        return false;
      };
      const adjacentAPla = (loc) => {
        for (let i = 0; i < 4; i++) if (c[loc + a[i]] === pla) return true;
        return false;
      };

      const construire = (loc0, idx) => {
        let tailTarget = loc0;
        let vNonNul = vLen[idx] > 0;
        let tete_ = 0, queue_ = 1;
        file[0] = loc0;
        regionDe[loc0] = idx;
        while (tete_ !== queue_) {
          const loc = file[tete_++];
          if (vNonNul && c[loc] === VIDE) {
            const s = vStart[idx], ancien = vLen[idx];
            let nouveau = 0;
            for (let i = 0; i < ancien; i++) {
              if (adjacentATete(loc, vitalList[s + i])) { vitalList[s + nouveau] = vitalList[s + i]; nouveau++; }
            }
            vLen[idx] = nouveau;
            vNonNul = nouveau > 0;
          }
          if (internes[idx] < 2 && !adjacentAPla(loc)) internes[idx]++;
          if (c[loc] === opp) contientOpp[idx] = 1;
          suivante[loc] = tailTarget;
          tailTarget = loc;
          for (let i = 0; i < 4; i++) {
            const v = loc + a[i];
            if ((c[v] === VIDE || c[v] === opp) && regionDe[v] === -1) { file[queue_++] = v; regionDe[v] = idx; }
          }
        }
        return tailTarget;
      };

      let auMoinsUne = false;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const loc = (x + 1) + (y + 1) * l;
        if (regionDe[loc] !== -1) continue;
        if (c[loc] !== VIDE) { auMoinsUne = auMoinsUne || (c[loc] === pla); continue; }
        const idx = nReg++;
        tetesReg[idx] = loc;
        vStart[idx] = vitalTotal; vLen[idx] = 0; internes[idx] = 0; contientOpp[idx] = 0;
        {
          const s = vStart[idx];
          let init = 0;
          for (let i = 0; i < 4; i++) {
            const v = loc + a[i];
            if (c[v] === pla) {
              const ph = tete[v];
              let present = false;
              for (let j = 0; j < init; j++) if (vitalList[s + j] === ph) { present = true; break; }
              if (!present) vitalList[s + init++] = ph;
            }
          }
          vLen[idx] = init;
        }
        const tail = construire(loc, idx);
        suivante[loc] = tail;
        vitalTotal += vLen[idx];
      }

      const tetesPla = [];
      for (let loc = 0; loc < taille; loc++) if (c[loc] === pla && tete[loc] === loc) tetesPla.push(loc);
      const tue = new Uint8Array(tetesPla.length);
      const vitalCompte = new Int32Array(taille);
      for (let i = 0; i < nReg; i++) {
        const s = vStart[i], ln = vLen[i];
        for (let j = 0; j < ln; j++) vitalCompte[vitalList[s + j]]++;
      }
      while (true) {
        let tueQuelquun = false;
        for (let i = 0; i < tetesPla.length; i++) {
          if (tue[i]) continue;
          const ph = tetesPla[i];
          if (vitalCompte[ph] < 2) {
            tue[i] = 1; tueQuelquun = true;
            let cur = ph;
            do {
              for (let j = 0; j < 4; j++) {
                const v = cur + a[j];
                const ri = regionDe[v];
                if (ri >= 0 && !bordeMortePar[tetesReg[ri]] && (c[v] === VIDE || c[v] === opp)) {
                  bordeMortePar[tetesReg[ri]] = 1;
                  const s = vStart[ri], ln = vLen[ri];
                  for (let k = 0; k < ln; k++) vitalCompte[vitalList[s + k]]--;
                }
              }
              cur = suiv[cur];
            } while (cur !== ph);
          }
        }
        if (!tueQuelquun) break;
      }
      for (let i = 0; i < tetesPla.length; i++) {
        if (!tue[i]) {
          const ph = tetesPla[i];
          let cur = ph;
          do { result[cur] = pla; cur = suiv[cur]; } while (cur !== ph);
        }
      }
      for (let i = 0; i < nReg; i++) {
        const head = tetesReg[i];
        let marquer = internes[i] <= 1 && !bordeMortePar[head] && auMoinsUne;
        marquer = marquer || (grandesSures && !contientOpp[i] && !bordeMortePar[head] && auMoinsUne);
        if (marquer) {
          let cur = head;
          do { result[cur] = pla; cur = suivante[cur]; } while (cur !== head);
        } else {
          const siVide = grandesIncertaines && !contientOpp[i] && auMoinsUne;
          if (siVide) {
            let cur = head;
            do { if (result[cur] === VIDE) result[cur] = pla; cur = suivante[cur]; } while (cur !== head);
          }
        }
      }
    }

    // contrôle de cohérence (pour les tests) : recalcule chaînes et libertés from scratch et compare
    verifier() {
      const n = this.n, c = this.c, a = this.adj;
      const vu = new Uint8Array(this.taille);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const loc = (x + 1) + (y + 1) * this.l;
        if (c[loc] === VIDE || vu[loc]) continue;
        const col = c[loc];
        const pile = [loc]; vu[loc] = 1;
        const pierres = [], libs = new Set();
        while (pile.length) {
          const p = pile.pop(); pierres.push(p);
          for (let i = 0; i < 4; i++) {
            const v = p + a[i];
            if (c[v] === col && !vu[v]) { vu[v] = 1; pile.push(v); }
            else if (c[v] === VIDE) libs.add(v);
          }
        }
        const h = this.tete[loc];
        for (const p of pierres) if (this.tete[p] !== h) throw new Error('tête incohérente en ' + p);
        if (this.nLibs[h] !== libs.size) throw new Error('libertés incohérentes : ' + this.nLibs[h] + ' vs ' + libs.size);
        if (this.nPierres[h] !== pierres.length) throw new Error('taille incohérente');
        let cur = h, k = 0;
        do { k++; cur = this.suiv[cur]; } while (cur !== h && k < 1000);
        if (k !== pierres.length) throw new Error('liste circulaire incohérente');
      }
      return true;
    }
  }

  return { Goban, VIDE, NOIR, BLANC, MUR, NUL, PASSE };
});
