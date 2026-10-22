// niveaux.js — niveaux forts du bot : la force vient de la recherche (nombre de visites de l'arbre).
// Les niveaux de 30 kyu à 1 dan suivent la formule de bot.js (nCoupsRang) ; 2 à 4 dan s'en rapprochent du meilleur coup du réseau (mix).
// 5 dan : le réseau seul (1 visite, aucun hasard) ; ensuite le nombre de visites double à chaque rang : 2, 4, 8, 16 ; « 9 dan + » : 48 visites au plus, 12 s max par coup.
(function (racine) {
  racine.GONIVEAUX = {
    '-4': { visites: 1 },                       // 5 dan
    '-5': { visites: 2, tempsMax: 8000 },       // 6 dan
    '-6': { visites: 4, tempsMax: 8000 },       // 7 dan
    '-7': { visites: 8, tempsMax: 8000 },       // 8 dan
    '-8': { visites: 16, tempsMax: 8000 },      // 9 dan
    '-9': { visites: 48, tempsMax: 12000 },     // 9 dan +
  };
})(typeof self !== 'undefined' ? self : this);
