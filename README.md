# Go — une partie tranquille contre un bot

Une appli de Go en noir et blanc, comme tes autres apps. **Un seul adversaire : un bot que tu règles de 30 kyu à 9 dan +.**
Tu choisis le plateau (9×9, 13×13 ou 19×19), tu joues, tu peux **passer** ou **abandonner** comme dans les vraies règles, et à la fin tu as **l'analyse de la partie** avec chaque coup classé.

Le bot, c'est un **vrai réseau KataGo** (le même genre d'IA que les meilleurs programmes de Go) qui tourne **dans ton téléphone**. Rien n'est envoyé sur internet : une fois l'appli chargée, elle marche sans réseau.

---

## 1. La mettre en ligne (comme Sudoku)

1. Décompresse `go.zip`. Tu obtiens un dossier avec `index.html`, `reseau.bin`, `nn.wasm`, etc.
2. Sur GitHub, dans le dépôt de l'appli, fais **Add file → Upload files** et **glisse tout le contenu du dossier** (pas le dossier lui-même, ses fichiers et sous-dossiers `icons`, `tests`, `outils`, `calib`).
   - Ne touche pas au dossier `.github`.
   - Le plus gros fichier (`reseau.bin`) fait 12 Mo : c'est sous la limite de 25 Mo de l'envoi par le site, ça passe.
3. Attends une ou deux minutes que GitHub Pages se mette à jour, puis ouvre l'adresse sur l'iPhone **dans Safari**.
4. Bouton Partager → **Sur l'écran d'accueil**. L'appli s'ouvre alors en plein écran.

À savoir :
- **La première ouverture demande internet** (elle télécharge le réseau, 12 Mo). Ensuite tout est gardé sur le téléphone.
- **iOS 16.4 ou plus** : le bot tourne en mode rapide. **Sur un iPhone plus ancien**, il passe tout seul en « mode compatible » (même bot, mêmes coups, mais environ 4 fois plus lent, et l'analyse est plus courte). Le menu l'indique.
- Seul le « mode d'isolement » de l'iPhone (Réglages › Confidentialité et sécurité) bloque complètement le bot : il coupe le calcul dont il a besoin.

**Si le bot ne répond pas**, ouvre `…/diagnostic.html` (même adresse que l'appli, en remplaçant `index.html` par `diagnostic.html`, ou touche **Diagnostic** quand l'appli affiche « Le bot ne démarre pas »). Cette page teste ton téléphone, chaque fichier sur GitHub (présent ? bonne taille ?), le chargement du réseau et un vrai coup du bot, puis te dit ce qui bloque. Les causes les plus fréquentes :
- un fichier manquant ou incomplet sur GitHub (surtout `reseau.bin`, 12 Mo) : renvoie-le avec **Add file → Upload files** ;
- GitHub n'a pas fini de mettre le site à jour (attends 2 minutes) ;
- une très mauvaise connexion pendant le premier chargement : le bouton **Réessayer** relance le chargement.
- Si tu remplaces des fichiers plus tard et que l'ancienne version reste affichée, ferme complètement l'appli puis rouvre-la deux fois.

---

## 2. Jouer

**Menu** : plateau (9×9, 13×13, 19×19) · niveau du bot (curseur ou boutons − / +) · ta couleur (Noir joue en premier, ou Hasard) · « Valider chaque coup ».

**Poser une pierre** : touche une case → une pierre fantôme apparaît → touche la même case encore (ou le bouton **Jouer**) pour confirmer. Tu peux changer d'avis en touchant une autre case. Si tu coupes « Valider chaque coup » dans le menu, un seul toucher suffit (pratique en 9×9, risqué en 19×19 où les cases sont petites).

**Passer / Abandonner** : deux boutons en bas. Abandonner demande une confirmation.

**Règles** : comptage par zone (comme les règles chinoises : pierres + territoire), komi 7,5 (6,5 en 9×9), pas de handicap, suicide interdit, ko et super-ko (on ne refait jamais une position déjà vue).

**La fin** : quand vous passez tous les deux, le bot propose les pierres mortes (elles deviennent pâles avec un petit carré de la couleur de celui qui les capture). **Touche un groupe pour dire s'il est mort ou vivant** ; le score se met à jour en direct. **Continuer à jouer** reprend la partie (si vous n'êtes pas d'accord), **Valider** donne le résultat. Si tu abandonnes, le résultat est donné tout de suite.

**Reprendre** : la partie est sauvegardée à chaque coup. Si tu fermes l'appli, le bouton **Reprendre** du menu te remet là où tu étais. Les parties terminées sont dans **Parties** (les 30 dernières).

---

## 3. L'analyse de la partie

Elle démarre toute seule à la fin de la partie (barre de progression). Quand elle est prête : **Voir l'analyse**.

**Résumé** : le résultat, la **précision** de chaque joueur, la perte moyenne par coup (en points), la courbe de la partie (qui est devant, touche-la pour aller à ce moment), et le nombre de coups de chaque sorte.

**Coups** : tu revois la partie coup par coup (flèches ◀ ▶). Sur le plateau : une pastille sur la pierre jouée, et un **cercle en pointillés** à l'endroit du meilleur coup quand ce n'était pas celui-là. Sous le plateau : la catégorie, les points perdus, l'évolution des chances de gagner. Les boutons **Erreur ◀ / Erreur ▶** sautent d'une erreur à l'autre.

| Pastille | Catégorie | En clair |
|---|---|---|
| `!!` | **Brillant** | un coup que le réseau n'avait pas vu venir, et qui est pourtant au niveau du meilleur (très rare) |
| `!` | **Très bon coup** | un bon coup pas évident : le seul qui marchait, ou une vraie surprise |
| `★` | **Meilleur coup** | le coup que choisit le réseau (ou équivalent) |
| `✓` | **Bon coup** | un coup correct, il perd très peu |
| `≡` | **Théorique** | un coup d'ouverture classique |
| `?` | **Erreur** | un coup qui fait perdre des points et des chances |
| `✕` | **Coup manqué** | l'adversaire venait de se tromper et tu n'en as pas profité |
| `??` | **Gaffe** | une très grosse perte |

Les seuils comptent en points *par rapport à la taille du plateau* (2 points perdus pèsent plus en 9×9 qu'en 19×19). Quand une partie est déjà gagnée ou perdue (plus de 98 % de chances), seules les énormes pertes sont signalées.

**Combien de temps ?** L'analyse fait chercher le réseau sur chaque coup (et plus longtemps sur les coups douteux), avec 2 à 3 calculs en parallèle. Sur l'ordinateur où j'ai testé (2 cœurs, sans rien d'autre en route) : **9×9 ≈ 30 secondes** (partie de 99 coups), **13×13 ≈ 1 min 20** (179 coups), **19×19 ≈ 4 minutes** pour une partie très longue (367 coups ; une partie normale de 250 coups prendra moins). **Je n'ai pas pu le mesurer sur un vrai iPhone** : ça dépendra de ton modèle. Tu peux revenir au menu pendant ce temps : l'analyse continue et le résultat apparaît dans **Parties**. Mais si tu lances une nouvelle partie, ou si tu fermes l'appli, l'analyse en cours s'arrête : dans **Parties**, touche la partie pour la relancer.

---

## 4. Les niveaux — ce qu'il faut savoir honnêtement

Le bot est un seul programme dont on règle la force :

- **30 kyu → 1 dan** : le bot tire quelques coups au hasard parmi les coups possibles et joue celui que le réseau préfère. Plus le niveau monte, plus il en tire, donc plus il joue juste. La formule vient de KaTrain (licence MIT), calibrée à l'origine sur de vrais joueurs.
- **2 → 4 dan** : il se rapproche peu à peu du meilleur coup du réseau.
- **5 dan** : le meilleur coup du réseau, sans hasard.
- **6 → 9 dan** : en plus, il réfléchit avec un arbre de variantes qui double à chaque rang (2, 4, 8, 16 explorations par coup).
- **9 dan +** : le maximum que l'appli peut faire (48 explorations, 12 secondes par coup au plus).

**Ces niveaux sont des estimations, pas des certificats.** Je n'ai pas fait jouer de vrais humains contre le bot, donc le nom « 12 kyu » reste un repère, pas une garantie.

Ce que j'ai vraiment mesuré (`calibrage.md`) : plus de 750 parties du bot contre lui-même **en 9×9**. Résultat : l'ensemble monte bien de 30 kyu à 9 dan (environ 1 300 points Elo d'écart), et chaque palier de 3 kyu bat le précédent jusqu'à 6 kyu. **Mais** certains niveaux voisins se valent presque : 6 kyu / 3 kyu, et 2 / 3 / 4 dan. **9 dan +** n'est pas mesuré, et le **19×19 non plus** (trop lent à faire jouer ici) ; en 13×13 j'ai seulement vérifié l'ordre grossier. Si le bot te paraît trop fort ou trop faible, change simplement de niveau : le curseur est fait pour ça.

---

## 5. Les limites (pour être clair)

- Je n'ai **pas pu tester sur un vrai iPhone** : le test automatique simule un iPhone dans un navigateur (touchers, écran 390×844 et 320×568). Le bot et l'analyse ont été vérifiés contre le vrai KataGo sur plus de 150 positions, mais la vitesse sur ton téléphone reste à voir.
- Le réseau est petit (10 blocs, 128 canaux) pour tenir dans 12 Mo : il est très fort, mais moins que les plus gros réseaux de KataGo.
- Sur un iPhone plus ancien que iOS 16.4, le « mode compatible » marche mais le bot réfléchit environ 4 fois moins vite et l'analyse est plus courte (moins précise). Je l'ai testé sur ordinateur (mêmes coups que le mode rapide), pas sur un vrai téléphone.
- Pas de synchronisation entre appareils : les parties restent dans l'iPhone (comme Sudoku).
- Pas de handicap, pas d'annulation de coup, pas d'autre règle que celles ci-dessus.
- L'analyse est approximative : elle juge avec peu d'explorations pour rester rapide. Un coup « Erreur » peut être discutable ; une partie très déséquilibrée donne des classements peu parlants.
- Le bot n'abandonne jamais : s'il perd, il continue jusqu'à ce que tu passes.

---

## 6. Pour les curieux

```
index.html  styles.css  app.js        l'écran
plateau.js                            dessin du goban, pastilles, courbe
moteur.js   worker.js                 le bot et l'analyse, dans des « workers » (l'écran reste fluide)
goban.js  situation.js  fin.js        les règles, la fin de partie, le comptage
features.js  moteur_nn.js  nn.wasm  nn_scalaire.wasm  reseau.bin    le réseau KataGo (calcul en WebAssembly ; nn_scalaire = version de secours sans calcul rapide)
diagnostic.html                       la page qui cherche pourquoi le bot ne répond pas
recherche.js  bot.js  niveaux.js  analyse.js      la recherche, les niveaux, la classification des coups
sw.js  manifest.webmanifest  icons/   pour que ça marche hors ligne et sur l'écran d'accueil
tests/  outils/  calib/               tests, fabrication du réseau, mesures des niveaux
```

Tests (sur ordinateur, avec Node et Python) :

```
node tests/test_regles.js        règles du Go, niveaux, classification des coups
node tests/valider_nn.js         compare le réseau avec le vrai KataGo (si le programme est installé)
python3 tests/e2e.py             parcours complet sur un iPhone simulé
```

Crédits : le réseau `g170e-b10c128` et la logique du plateau viennent de **KataGo** (David J Wu, licence MIT) ; la formule des niveaux faibles vient de **KaTrain** (Sander Land, licence MIT). Les licences sont dans `LICENCES.txt`.
