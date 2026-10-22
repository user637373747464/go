# Calibrage des niveaux

Pour vérifier que chaque niveau est plus fort que le précédent, j'ai fait jouer le bot **contre lui-même** (un niveau contre un autre, couleurs alternées, ouvertures légèrement variées) et j'ai calculé des notes **Elo** à partir des résultats (modèle de Bradley-Terry).
Une différence de 100 points Elo ≈ 64 % de victoires pour le plus fort.

**Ce que ça prouve** : l'ordre des niveaux et l'écart entre eux *dans ce bot*.
**Ce que ça ne prouve pas** : le lien avec de vrais rangs de club. Les noms (« 12 kyu »…) viennent de la formule de KaTrain pour les niveaux faibles, et d'un nombre d'explorations qui double à chaque rang pour les niveaux forts : ce sont des repères.
La note de chaque niveau est donnée **par rapport au plus faible mesuré** (0 = 30 kyu).

## Plateau 9×9 (784 parties)

| Niveau | Réglage | Note Elo | ± | Parties |
|---|---|---|---|---|
| 30 kyu | K30 | 0 | 60 | 48 |
| 27 kyu | K27 | 125 | 48 | 64 |
| 24 kyu | K24 | 214 | 43 | 80 |
| 21 kyu | K21 | 300 | 41 | 96 |
| 18 kyu | K18 | 380 | 40 | 96 |
| 15 kyu | K15 | 468 | 40 | 96 |
| 12 kyu | K12 | 562 | 40 | 96 |
| 9 kyu | K9 | 628 | 39 | 96 |
| 6 kyu | K6 | 768 | 39 | 96 |
| 3 kyu | K3 | 755 | 39 | 96 |
| 1 dan | K0 | 807 | 36 | 112 |
| 2 dan | M25 | 955 | 52 | 48 |
| 3 dan | M50 | 952 | 45 | 64 |
| 4 dan | M75 | 942 | 51 | 48 |
| (formule, rang −3) | K-3 | 874 | 39 | 100 |
| 5 dan | V1 | 1072 | 35 | 128 |
| 6 dan | V2 | 1042 | 50 | 60 |
| 7 dan | V4 | 1142 | 49 | 60 |
| 8 dan | V8 | 1228 | 54 | 48 |
| 9 dan | V16 | 1335 | 68 | 36 |

## Plateau 13×13 (18 parties)

| Niveau | Réglage | Note Elo | ± | Parties |
|---|---|---|---|---|
| 30 kyu | K30 | 0 | 220 | 5 |
| 20 kyu | K20 | 240 | 158 | 8 |
| 10 kyu | K10 | 434 | 147 | 10 |
| 1 dan | K0 | 627 | 158 | 8 |
| 5 dan | V1 | 867 | 220 | 5 |

Réglages : `K<n>` = rang n de la formule (30 kyu = K30, 1 dan = K0) ; `M<p>` = entre 1 dan et le meilleur coup du réseau (p % du chemin) ; `V<n>` = le meilleur coup après n explorations de l'arbre (V1 = le réseau seul).

Comment lire ce tableau :
- « ± » est l'incertitude approximative (un écart-type). Deux niveaux dont les notes diffèrent de moins de 2 fois ce « ± » ne se distinguent pas vraiment.
- **Ce qui est solide** : de 30 kyu à 9 kyu, chaque palier de 3 rangs bat nettement le précédent (environ +65 à +140 Elo par palier). Au total, le niveau « 9 dan » bat le « 30 kyu » d'environ 1 300 Elo, et de « 5 dan » à « 9 dan » on gagne encore environ 260 Elo (7 dan et 8 dan montent bien dans l'ordre).
- **Ce qui est flou** : 6 kyu et 3 kyu sont à égalité, et le palier 3 kyu → 1 dan est petit (+50) ; 2, 3 et 4 dan se valent presque (en 9×9, entre « 1 dan » et « le meilleur coup du réseau » il n'y a pas beaucoup de place) ; 5 dan et 6 dan aussi. Sur ces niveaux, le curseur change moins la force que ce que son nom laisse croire.
- **9 dan +** (48 explorations, jusqu'à 12 s par coup) n'est **pas mesuré** : c'est le même principe que 9 dan en plus poussé, trop lent pour faire jouer des centaines de parties ici.
- **13×13** : seulement un contrôle léger (peu de parties, voir le nombre dans le tableau) ; il confirme l'ordre grossier 30 kyu < 20 kyu < 10 kyu < 1 dan < 5 dan. **19×19 n'est pas mesuré** (parties trop longues pour cette machine). Les niveaux y sont ceux de la même formule, mais je n'ai pas de chiffres.
- Les parties bot contre bot n'utilisent pas la limite de temps de l'appli (12 s au plus par coup) : sur un téléphone lent, les niveaux forts peuvent donc être un peu plus faibles.
