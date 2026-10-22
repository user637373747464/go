// plateau.js — dessin du goban (SVG), des pastilles de classification et de la courbe de partie.
(function (racine) {
  'use strict';
  const GG = racine.GoGoban;
  const { NOIR, BLANC, VIDE } = GG;
  const LETTRES = 'ABCDEFGHJKLMNOPQRST';
  const U = 10;                  // une case = 10 unités
  const PAD = 9.5;               // marge autour de la grille

  const etoiles = (n) => {
    if (n === 9) return [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]];
    if (n === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]];
    const r = [], a = [3, 9, 15];
    for (const y of a) for (const x of a) r.push([x, y]);
    return r;
  };
  const xy = (g, loc) => [(loc % g.l) - 1, ((loc / g.l) | 0) - 1];
  const nomCase = (n, g, loc) => { const [x, y] = xy(g, loc); return LETTRES[x] + (n - y); };

  // ---------- pastilles ----------
  const STYLE = {
    brillant:  { fond: '#fff', trait: '#000', glyphe: '#000' },
    tres_bon:  { fond: '#fff', trait: '#000', glyphe: '#000' },
    meilleur:  { fond: '#fff', trait: '#000', glyphe: '#000' },
    bon:       { fond: '#2a2a2e', trait: '#fff', glyphe: '#fff' },
    theorique: { fond: '#2a2a2e', trait: '#8e8e93', glyphe: '#c8c8cc' },
    erreur:    { fond: '#8e8e93', trait: '#000', glyphe: '#000' },
    manque:    { fond: '#8e8e93', trait: '#000', glyphe: '#000' },
    gaffe:     { fond: '#000', trait: '#fff', glyphe: '#fff' },
  };
  function etoile5(R) {
    const p = [];
    for (let i = 0; i < 10; i++) { const a = (-90 + i * 36) * Math.PI / 180, r = i % 2 ? R * 0.42 : R; p.push((Math.cos(a) * r).toFixed(2) + ' ' + (Math.sin(a) * r).toFixed(2)); }
    return 'M' + p.join('L') + 'Z';
  }
  const ETOILE = etoile5(5.6);
  function glyphe(cl, c) {
    const f = c, tr = `stroke="${c}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
    switch (cl) {
      case 'brillant': return `<text y="3.9" text-anchor="middle" font-size="11.5" font-weight="900" fill="${f}">!!</text>`;
      case 'tres_bon': return `<text y="4.4" text-anchor="middle" font-size="13" font-weight="900" fill="${f}">!</text>`;
      case 'meilleur': return `<path d="${ETOILE}" fill="${f}"/>`;
      case 'bon': return `<path d="M-4.4 0.4L-1.4 3.6L4.6 -3.6" ${tr}/>`;
      case 'theorique': return `<path d="M-4.4 -3.1H4.4M-4.4 0H4.4M-4.4 3.1H4.4" ${tr}/>`;
      case 'erreur': return `<text y="4.3" text-anchor="middle" font-size="13" font-weight="900" fill="${f}">?</text>`;
      case 'manque': return `<path d="M-3.7 -3.7L3.7 3.7M3.7 -3.7L-3.7 3.7" ${tr}/>`;
      case 'gaffe': return `<text y="3.9" text-anchor="middle" font-size="11.5" font-weight="900" fill="${f}">??</text>`;
    }
    return '';
  }
  // pastille centrée en (0,0), de rayon r
  function pastilleG(cl, r) {
    const s = STYLE[cl]; if (!s) return '';
    return `<g transform="scale(${(r / 10).toFixed(3)})"><circle r="9.4" fill="${s.fond}" stroke="${s.trait}" stroke-width="1.6"/>${glyphe(cl, s.glyphe)}</g>`;
  }
  function pastille(cl, taille) {
    const t = taille || 22;
    return `<svg class="past" viewBox="-10 -10 20 20" width="${t}" height="${t}" aria-hidden="true">${pastilleG(cl, 10)}</svg>`;
  }

  // ---------- plateau ----------
  // g : Goban ; o : { dernier, ko, fantome:{loc,pla}, mortes:Set, zone:Uint8Array, badge:{loc,cl}, meilleur:loc, coord:bool }
  function svgPlateau(g, o) {
    o = o || {};
    const n = g.n, S = (n - 1) * U + 2 * PAD, fin = (n - 1) * U;
    let s = `<svg viewBox="${-PAD} ${-PAD} ${S} ${S}" class="goban" data-n="${n}" role="img" aria-label="Plateau de go ${n} sur ${n}">`;
    s += `<rect x="${-PAD}" y="${-PAD}" width="${S}" height="${S}" rx="5" class="g-fond"/>`;
    let d = '';
    for (let i = 0; i < n; i++) d += `M0 ${i * U}H${fin}M${i * U} 0V${fin}`;
    s += `<path d="${d}" class="g-lignes"/>`;
    s += `<rect x="0" y="0" width="${fin}" height="${fin}" class="g-cadre"/>`;
    for (const [x, y] of etoiles(n)) s += `<circle cx="${x * U}" cy="${y * U}" r="1.15" class="g-etoile"/>`;
    if (o.coord !== false) {
      for (let i = 0; i < n; i++) {
        s += `<text x="${i * U}" y="${fin + 7.7}" class="g-coord" text-anchor="middle">${LETTRES[i]}</text>`;
        s += `<text x="-7.1" y="${i * U + 1.4}" class="g-coord" text-anchor="middle">${n - i}</text>`;
      }
    }
    const mortes = o.mortes, zone = o.zone;
    let pierres = '', marques = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const loc = (x + 1) + (y + 1) * g.l, c = g.c[loc], cx = x * U, cy = y * U;
      if (c === NOIR || c === BLANC) {
        const morte = mortes && mortes.has(loc);
        pierres += `<circle cx="${cx}" cy="${cy}" r="4.75" class="${c === NOIR ? 'p-noir' : 'p-blanc'}${morte ? ' p-morte' : ''}"/>`;
        if (zone && morte) marques += `<rect x="${cx - 1.7}" y="${cy - 1.7}" width="3.4" height="3.4" class="${c === NOIR ? 'z-blanc' : 'z-noir'}"/>`;
      } else if (zone && zone[loc]) {
        marques += `<rect x="${cx - 1.7}" y="${cy - 1.7}" width="3.4" height="3.4" class="${zone[loc] === NOIR ? 'z-noir' : 'z-blanc'}"/>`;
      }
    }
    s += pierres + marques;
    if (o.ko && o.ko !== 0) { const [x, y] = xy(g, o.ko); s += `<rect x="${x * U - 2.4}" y="${y * U - 2.4}" width="4.8" height="4.8" class="g-ko"/>`; }
    if (o.dernier && o.dernier !== GG.PASSE && o.dernier !== GG.NUL) {
      const [x, y] = xy(g, o.dernier), c = g.c[o.dernier];
      s += `<circle cx="${x * U}" cy="${y * U}" r="2.1" class="${c === NOIR ? 'm-noir' : 'm-blanc'}"/>`;
    }
    if (o.meilleur && o.meilleur !== GG.PASSE) {
      const [x, y] = xy(g, o.meilleur);
      s += `<circle cx="${x * U}" cy="${y * U}" r="4.1" class="g-meilleur"/>`;
    }
    if (o.fantome) {
      const [x, y] = xy(g, o.fantome.loc);
      s += `<circle cx="${x * U}" cy="${y * U}" r="4.75" class="${o.fantome.pla === NOIR ? 'p-noir' : 'p-blanc'} fantome"/>`;
    }
    if (o.badge && o.badge.loc && o.badge.loc !== GG.PASSE) {
      const [x, y] = xy(g, o.badge.loc);
      s += `<g transform="translate(${x * U + 4.2} ${y * U - 4.2})">${pastilleG(o.badge.cl, 4.6)}</g>`;
    }
    return s + '</svg>';
  }

  // position (clientX, clientY) -> case, ou 0 si hors du plateau
  function caseSous(svg, g, cx, cy) {
    const r = svg.getBoundingClientRect(), n = g.n, S = (n - 1) * U + 2 * PAD;
    const ux = (cx - r.left) / r.width * S - PAD, uy = (cy - r.top) / r.height * S - PAD;
    const x = Math.round(ux / U), y = Math.round(uy / U);
    if (x < 0 || y < 0 || x >= n || y >= n) return 0;
    if (Math.hypot(ux - x * U, uy - y * U) > 0.78 * U) return 0;
    return (x + 1) + (y + 1) * g.l;
  }

  // ---------- courbe de partie ----------
  // gains : probabilité de victoire de Noir à chaque position (0..1) ; opts : { cur, marques:[{i,cl}] }
  function svgCourbe(gains, opts) {
    opts = opts || {};
    const W = 320, H = 84, T = Math.max(1, gains.length - 1);
    const X = (i) => (i / T * W).toFixed(1), Y = (p) => (4 + (1 - p) * (H - 8)).toFixed(1);
    let line = '';
    for (let i = 0; i < gains.length; i++) line += (i ? 'L' : 'M') + X(i) + ' ' + Y(gains[i]);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="courbe" preserveAspectRatio="none" data-t="${T}" role="img" aria-label="Courbe de la partie">`;
    s += `<path d="${line}L${W} ${H}L0 ${H}Z" class="c-aire"/>`;
    s += `<path d="M0 ${H / 2}H${W}" class="c-mil"/>`;
    s += `<path d="${line}" class="c-ligne"/>`;
    s += '</svg>';
    // les pastilles sont dessinées en HTML pour ne pas être déformées
    return s;
  }

  racine.GoPlateau = { svgPlateau, caseSous, svgCourbe, pastille, pastilleG, nomCase, xy, STYLE, LETTRES };
})(typeof self !== 'undefined' ? self : this);
