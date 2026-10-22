"""Test de bout en bout dans un faux iPhone (Chromium, 390x844 puis 320x568, tactile).
Lancer :  python3 tests/e2e.py        (captures d'écran : GO_SHOTS=/un/dossier python3 tests/e2e.py)
Nécessite : pip install playwright  (et un Chromium installé). Le vrai réseau KataGo tourne dans le navigateur : compter 2 à 4 minutes."""
import json, os, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get('GO_SHOTS')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)

def port_libre():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

PORT = port_libre()
serveur = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=RACINE,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
URL = 'http://127.0.0.1:%d/index.html' % PORT
LONG = 600000     # ms : le calcul peut être lent sur une machine chargée

n_ok = 0
def ok(cond, msg):
    global n_ok
    if not cond:
        print('ECHEC :', msg); raise SystemExit(1)
    n_ok += 1
    print('  ok -', msg)

def shot(page, nom, **kw):
    if SHOTS: page.screenshot(path=os.path.join(SHOTS, nom + '.png'), **kw)

def ouvrir(b, w=390, h=844, stock=None):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    erreurs = []
    page.on('pageerror', lambda e: erreurs.append(str(e)))
    page.on('console', lambda m: erreurs.append('console: ' + m.text) if m.type == 'error' else None)
    page.erreurs = erreurs
    if stock is not None:
        page.add_init_script("if(!sessionStorage.getItem('deja')){sessionStorage.setItem('deja','1');localStorage.setItem('go-v1',%s)}" % json.dumps(json.dumps(stock)))
    page.goto(URL)
    page.wait_for_selector('.menu')
    return ctx, page

def stock_pour(coups, n=9, phase='marquage', humain=1, k=30, historique=None):
    return {'reglages': {'taille': n, 'niveau': k, 'couleur': 'noir', 'confirmer': True},
            'enCours': {'id': 1, 'date': int(time.time() * 1000), 'n': n, 'k': k, 'humain': humain, 'coups': coups, 'phase': phase, 'mortes': []} if coups is not None else None,
            'historique': historique or []}

def sauvegarde(page):
    return json.loads(page.evaluate("localStorage.getItem('go-v1')"))

def point(page, n, x, y):
    box = page.query_selector('#plateau svg').bounding_box()
    S = (n - 1) * 10 + 19
    return (box['x'] + ((x * 10 + 9.5) / S) * box['width'], box['y'] + ((y * 10 + 9.5) / S) * box['height'])

def taper_point(page, n, x, y):
    px, py = point(page, n, x, y)
    page.touchscreen.tap(px, py)

def attendre_coups(page, nb):
    page.wait_for_function("(nb) => window.GoApp.G && window.GoApp.G.coups.length >= nb && !window.GoApp.G.pense", arg=nb, timeout=LONG)

def libre(page, n):
    # une case libre et légale pour le joueur, en commençant par les coins
    return page.evaluate("""(n) => { const G = window.GoApp.G; const g = G.sit.g;
        const essais = [[0,0],[n-1,n-1],[0,n-1],[n-1,0],[1,1],[n-2,n-2],[1,n-2],[n-2,1]];
        for (const [x, y] of essais) { const l = g.loc(x, y); if (g.c[l] === 0 && G.sit.estLegal(l, G.humain)) return [x, y]; }
        return [0, 0]; }""", n)

def sans_debordement(page, msg):
    d = page.evaluate("() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})")
    ok(d['sw'] <= d['cw'], msg + ' (pas de défilement horizontal)')

with sync_playwright() as p:
    b = p.chromium.launch()
    try:
        # ---------------------------------------------------------------- menu
        print('Menu')
        ctx, page = ouvrir(b)
        sans_debordement(page, 'menu')
        ok(page.inner_text('#nivNom') == '12 kyu', 'niveau par défaut : 12 kyu')
        page.tap('[data-act=taille][data-v="13"]')
        ok('on' in (page.get_attribute('[data-act=taille][data-v="13"]', 'class') or ''), '13×13 sélectionné')
        page.tap('[data-act="niv-"]')
        ok(page.inner_text('#nivNom') == '13 kyu', 'bouton − : 13 kyu')
        page.tap('[data-act="niv+"]'); page.tap('[data-act="niv+"]')
        ok(page.inner_text('#nivNom') == '11 kyu', 'bouton + : 11 kyu')
        for _ in range(11): page.tap('[data-act="niv+"]')
        ok(page.inner_text('#nivNom') == '1 dan', '1 kyu → 1 dan')
        page.evaluate("() => { const r = document.getElementById('nivRange'); r.value = 39; r.dispatchEvent(new Event('input', {bubbles: true})); }")
        ok(page.inner_text('#nivNom') == '9 dan +', 'curseur au maximum : 9 dan +')
        page.evaluate("() => { const r = document.getElementById('nivRange'); r.value = 0; r.dispatchEvent(new Event('input', {bubbles: true})); }")
        ok(page.inner_text('#nivNom') == '30 kyu', 'curseur au minimum : 30 kyu')
        ok(sauvegarde(page)['reglages']['niveau'] == 30 and sauvegarde(page)['reglages']['taille'] == 13, 'réglages sauvegardés')
        shot(page, 'menu')
        ctx.close()

        # ---------------------------------------------------------------- partie
        print('Partie (9×9, 30 kyu, Noir)')
        ctx, page = ouvrir(b, stock=stock_pour(None, k=30))
        page.tap('[data-act=taille][data-v="9"]')
        page.tap('[data-act=jouer]')
        page.wait_for_selector('.goban')
        sans_debordement(page, 'écran de jeu')
        page.wait_for_function("window.GoApp.moteur.pret", timeout=LONG)
        taper_point(page, 9, 4, 4)
        ok(page.evaluate("window.GoApp.G.coups.length") == 0, 'premier toucher : pierre fantôme, rien de joué')
        shot(page, 'jeu_fantome')
        page.tap('[data-act=poser]')
        ok(page.evaluate("window.GoApp.G.coups[0][1]") == 5 + 5 * 10, 'le coup est joué en E5')
        attendre_coups(page, 2)
        ok(page.evaluate("window.GoApp.G.coups.length") == 2, 'le bot répond')
        taper_point(page, 9, 4, 4)
        ok('occupée' in page.inner_text('#message'), 'case occupée : message')
        x, y = libre(page, 9)
        taper_point(page, 9, x, y); taper_point(page, 9, x, y)       # deuxième toucher au même endroit = jouer
        attendre_coups(page, 4)
        ok(page.evaluate("window.GoApp.G.coups.length") == 4, 'toucher deux fois la même case joue le coup')
        ok(sauvegarde(page)['enCours']['coups'].__len__() == 4, 'partie sauvegardée à chaque coup')
        page.tap('[data-act=passer]')
        page.wait_for_function("window.GoApp.G.coups.length >= 6 || window.GoApp.G.phase !== 'jeu'", timeout=LONG)
        ok(page.evaluate("window.GoApp.G.coups[4][1]") == 1, 'Passer : le coup est une passe')
        shot(page, 'jeu_apres_passe')
        # reprise après rechargement
        page.reload(); page.wait_for_selector('.menu')
        ok(page.query_selector('[data-act=reprendre]') is not None, 'bouton Reprendre après rechargement')
        page.tap('[data-act=reprendre]')
        page.wait_for_selector('.goban')
        ok(page.evaluate("window.GoApp.G.coups.length") >= 5, 'la partie reprend où elle était')
        # abandon
        page.wait_for_function("!window.GoApp.G.pense", timeout=LONG)
        page.tap('[data-act=abandon]')
        page.wait_for_selector('.voile')
        shot(page, 'abandon_confirmation')
        page.tap('[data-act=abandon-non]')
        ok(page.query_selector('.voile') is None, 'Non : on continue')
        page.tap('[data-act=abandon]'); page.tap('[data-act=abandon-oui]')
        page.wait_for_selector('.analyse')
        ok('abandonné' in page.inner_text('.score'), 'abandon : résultat affiché')
        ok(page.evaluate("window.GoApp.stock.enCours") is None, 'la partie n\'est plus « en cours »')
        t0 = time.time()
        page.wait_for_selector('[data-act=voir-analyse]', timeout=LONG)
        print('    analyse de la partie en %.0f s' % (time.time() - t0))
        shot(page, 'fin_analyse_prete')
        page.tap('[data-act=voir-analyse]')
        page.wait_for_selector('.resume')
        sans_debordement(page, 'résumé')
        ok(len(page.query_selector_all('.lig')) == 8, 'huit catégories de coups dans le résumé')
        noms = [e.inner_text() for e in page.query_selector_all('.lig .lib')]
        ok(noms == ['Brillant', 'Très bon coup', 'Meilleur coup', 'Bon coup', 'Théorique', 'Erreur', 'Coup manqué', 'Gaffe'], 'catégories : ' + ', '.join(noms))
        shot(page, 'resume', full_page=True)
        page.tap('[data-act=onglet][data-v=revue]')
        page.wait_for_selector('.coups')
        page.tap('[data-act=aller][data-v="1"]')
        ok('Coup 1' in page.inner_text('.carte-c'), 'revue : coup 1')
        page.tap('[data-act=aller][data-v="2"]')
        ok('Coup 2' in page.inner_text('.carte-c'), 'revue : flèche suivante')
        page.tap('.nav .nb:nth-child(2)')
        ok('Coup 1' in page.inner_text('.carte-c'), 'revue : flèche précédente')
        shot(page, 'revue', full_page=True)
        page.tap('[data-act=quitter-revue]')
        page.wait_for_selector('.analyse, [data-act=voir-analyse]')
        page.tap('[data-act=menu]'); page.wait_for_selector('.menu')
        ok(page.query_selector('[data-act=historique]') is not None, 'bouton Parties dans le menu')
        page.tap('[data-act=historique]')
        page.wait_for_selector('.hist')
        ok(len(page.query_selector_all('.hist')) == 1, 'la partie est dans l\'historique')
        shot(page, 'historique')
        page.tap('.hist-c')
        page.wait_for_selector('.resume')
        ok(True, 'ouvrir une partie passée : résumé')
        page.tap('[data-act=quitter-revue]')
        page.wait_for_selector('.hist')
        page.tap('.hist-x'); page.tap('.hist-x')
        page.wait_for_selector('.hist-page')
        ok(len(page.query_selector_all('.hist')) == 0, 'supprimer demande une confirmation puis efface')
        ok(not page.erreurs, 'aucune erreur de page : %s' % page.erreurs)
        ctx.close()

        # ---------------------------------------------------------------- fin de partie : pierres mortes
        print('Fin de partie')
        ctx, page = ouvrir(b, stock=stock_pour([[1, 3 + 3 * 10], [2, 7 + 7 * 10], [1, 1], [2, 1]], k=30))
        page.tap('[data-act=reprendre]')
        page.wait_for_function("document.querySelector('#message') && document.querySelector('#message').textContent.includes('Touchez')", timeout=LONG)
        ok(page.evaluate("window.GoApp.G.phase") == 'marquage', 'deux passes : on passe au marquage')
        ok('devant' in page.inner_text('.score'), 'score affiché')
        shot(page, 'marquage')
        avant = page.evaluate("window.GoApp.G.mortes.size")
        taper_point(page, 9, 2, 2)           # la pierre noire (case C7)
        apres = page.evaluate("window.GoApp.G.mortes.size")
        ok(apres != avant, 'toucher un groupe change son état (mort / vivant) : %d -> %d pierres mortes' % (avant, apres))
        taper_point(page, 9, 2, 2)
        ok(page.evaluate("window.GoApp.G.mortes.size") == avant, 'le toucher suivant le remet comme avant')
        page.tap('[data-act=continuer]')
        page.wait_for_selector('.goban')
        ok(page.evaluate("window.GoApp.G.phase") == 'jeu', 'Continuer à jouer : retour au jeu')
        ok(page.evaluate("window.GoApp.G.coups.length") == 2, 'les deux passes sont retirées')
        ctx.close()
        # partie finie par accord : Valider donne un résultat chiffré
        ctx, page = ouvrir(b, stock=stock_pour([[1, 3 + 3 * 10], [2, 7 + 7 * 10], [1, 1], [2, 1]], k=30))
        page.tap('[data-act=reprendre]')
        page.wait_for_function("document.querySelector('#message') && document.querySelector('#message').textContent.includes('Touchez')", timeout=LONG)
        page.tap('[data-act=valider]')
        page.wait_for_selector('.analyse')
        ok('points' in page.inner_text('.score'), 'Valider : résultat chiffré (%s)' % page.inner_text('.score').replace('\n', ' / '))
        ctx.close()

        # ---------------------------------------------------------------- petit écran
        print('Petit écran (320×568)')
        ctx, page = ouvrir(b, 320, 568, stock=stock_pour(None, k=20))
        sans_debordement(page, 'menu 320')
        shot(page, 'menu_petit')
        page.tap('[data-act=jouer]'); page.wait_for_selector('.goban')
        sans_debordement(page, 'jeu 320')
        bas = page.evaluate("() => { const r = document.querySelector('.actions').getBoundingClientRect(); return r.bottom; }")
        ok(bas <= 568, 'les boutons sont visibles sans défiler (bas à %d px)' % bas)
        shot(page, 'jeu_petit')
        ctx.close()
        print('\n%d vérifications réussies' % n_ok)
    finally:
        b.close()
        serveur.terminate()
