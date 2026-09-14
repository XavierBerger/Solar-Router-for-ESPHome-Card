dépôt git : https://github.com/XavierBerger/Solar-Router-for-ESPHome-Card

# Plan de développement — Visualisation énergétique

## 1. Contexte

Le projet concerné est le dépôt GitHub **Solar Router for ESPHome Card**, sur la branche `feat/solar_inverter_simulator`.

Le dépôt contient notamment un **simulateur Fronius en Rust** (`fronius-simulator/`) qui expose une API compatible avec plusieurs endpoints Fronius et possède un endpoint spécifique :

```text
GET /simulation/day
```

Cet endpoint retourne les données simulées d'une journée complète sous forme de `DayData`, avec un échantillon toutes les 60 secondes, soit **1440 points par journée**.

Le simulateur fournit notamment :

- production photovoltaïque ;
- consommation électrique ;
- puissance réseau ;
- énergie journalière ;
- import réseau cumulé ;
- export réseau cumulé ;
- taux d'autoconsommation ;
- taux d'autonomie.

### Important

L'objectif de ce travail **n'est pas de développer une carte Home Assistant en première intention**.

La première étape doit produire un **viewer graphique autonome du simulateur**, utilisable indépendamment de Home Assistant.

La deuxième étape consistera à **réutiliser la brique graphique produite en phase 1** afin de construire une custom Lovelace card alimentée par les données réelles de Home Assistant.

L'objectif est donc d'éviter de développer deux fois le même moteur de visualisation.

---

# 2. Vision globale

L'architecture cible est la suivante :

```text
                         SOURCES DE DONNÉES
                                │
                ┌───────────────┴───────────────┐
                │                               │
                ▼                               ▼
       Simulateur Fronius                Home Assistant
          Phase 1                         Phase 2
                │                               │
                ▼                               ▼
       ┌────────────────┐             ┌────────────────┐
       │ Data Adapter   │             │ Data Adapter   │
       │ Simulator      │             │ Home Assistant │
       └───────┬────────┘             └───────┬────────┘
               │                              │
               └──────────────┬───────────────┘
                              ▼
                  ┌────────────────────────┐
                  │ Modèle normalisé       │
                  │ de séries énergétiques │
                  └────────────┬───────────┘
                               │
                               ▼
                  ┌────────────────────────┐
                  │ Energy Chart Renderer  │
                  │         uPlot          │
                  └────────────┬───────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
             Viewer autonome        Custom Lovelace
              du simulateur              Card
```

Le principe essentiel est :

> **Le renderer graphique ne doit connaître ni Fronius, ni le simulateur, ni Home Assistant.**

Il reçoit uniquement un modèle de données normalisé.

---

# 3. Choix technologique

## 3.1 Frontend

La phase 1 doit rester volontairement simple :

- HTML ;
- CSS ;
- JavaScript natif ;
- aucune application React/Vue/Svelte ;
- aucune chaîne Node/npm/bundler ;
- aucune base de données.

Le viewer doit pouvoir être servi directement par le simulateur Rust.

---

## 3.2 Moteur graphique

Le moteur graphique retenu est **uPlot**.

Raison du choix :

- spécialisé dans les séries temporelles ;
- très léger ;
- adapté aux gros volumes de points ;
- zoom temporel ;
- curseur interactif ;
- tooltip ;
- axes temporels ;
- possibilité de synchroniser plusieurs graphiques ;
- compatible avec une utilisation directe depuis une page HTML/JS ;
- adapté à un futur affichage temps réel.

uPlot est donc utilisé comme **moteur de rendu**, pas comme couche métier.

---

# 4. Modèle de données commun

Le point le plus important de la conception est de définir un modèle indépendant de la source.

Le renderer devra recevoir des données conceptuellement équivalentes à :

```javascript
{
    timestamp,
    solar,
    consumption,
    solarToLoad,
    gridImport,
    gridExport
}
```

où :

| Champ         | Signification                            | Unité     |
| ------------- | ---------------------------------------- | --------- |
| `timestamp`   | instant de mesure                        | timestamp |
| `solar`       | production photovoltaïque                | W         |
| `consumption` | consommation totale                      | W         |
| `solarToLoad` | production solaire consommée directement | W         |
| `gridImport`  | puissance importée depuis le réseau      | W         |
| `gridExport`  | puissance injectée vers le réseau        | W         |

Le renderer ne doit pas avoir besoin de connaître `pv_power_w`, `grid_power_w`, `DaySample`, etc.

Ces notions appartiennent à l'adaptateur de données.

---

# 5. Calcul des séries dérivées

Dans le simulateur, la relation fondamentale est :

```text
grid_power_w = load_power_w - pv_power_w
```

avec :

- `grid_power_w > 0` → import ;
- `grid_power_w < 0` → export.

L'adaptateur devra transformer ces données en séries explicites.

## Import réseau

```javascript
gridImport = Math.max(gridPower, 0);
```

## Export réseau

```javascript
gridExport = Math.max(-gridPower, 0);
```

## Autoconsommation instantanée

```javascript
solarToLoad = Math.min(solar, consumption);
```

## Vérification de cohérence

La consommation doit respecter :

```text
consumption = solarToLoad + gridImport
```

Cette relation doit être vérifiée dans les tests.

---

# 6. Phase 1 — Viewer d'une journée du simulateur

## 6.1 Objectif

Construire une page web autonome permettant de visualiser et comprendre le fonctionnement du simulateur sur une journée complète.

La page doit être accessible directement depuis le simulateur Rust.

Exemple :

```text
http://localhost:8080/
```

Elle récupère les données avec :

```text
GET /simulation/day
```

---

# 7. Phase 1 — Structure cible

Une première structure possible :

```text
fronius-simulator/
├── Cargo.toml
├── Cargo.lock
├── Dockerfile
├── src/
│   ├── api.rs
│   ├── config.rs
│   ├── day.rs
│   ├── lib.rs
│   ├── main.rs
│   └── simulation.rs
│
└── viewer/
    ├── index.html
    ├── style.css
    ├── viewer.js
    └── lib/
        └── uplot/
            ├── uPlot.iife.min.js
            └── uPlot.min.css
```

La structure exacte peut évoluer, mais la séparation suivante doit être conservée :

```text
viewer
 ├── UI
 ├── Data Adapter
 ├── modèle normalisé
 └── renderer uPlot
```

---

# 8. Phase 1 — Graphique principal

Le premier graphique représente la relation entre production solaire et consommation.

Il doit occuper environ **70 % de la hauteur disponible**.

Il doit afficher :

### Production solaire

- courbe ;
- remplissage sous la courbe ;
- unité : W.

### Consommation

La consommation totale doit être représentée comme la somme de :

```text
consommation solaire directe
+
import réseau
```

Les deux composantes doivent être visuellement distinguables.

Conceptuellement :

```text
              Production solaire
                     ╭──────╮
                    ╱        ╲
                   ╱          ╲
                  ╱            ╲
─────────────────╯              ╰──────────

              Consommation
          ┌─────────────────────┐
          │ consommation solaire│
          ├─────────────────────┤
          │    import réseau    │
          └─────────────────────┘
```

La production solaire doit être une série distincte de la consommation.

La consommation doit permettre de comprendre immédiatement quelle partie est couverte par le solaire et quelle partie provient du réseau.

---

# 9. Phase 1 — Graphique réseau

Un deuxième graphique doit occuper environ **30 % de la hauteur**.

Il représente les échanges avec le réseau.

Convention :

```text
          puissance positive
                 │
                 │  export solaire
                 │
─────────────────┼────────────────── 0 W
                 │
                 │  import réseau
                 │
          puissance négative
```

Donc :

```text
gridExport > 0
```

est affiché au-dessus de zéro.

Et :

```text
gridImport > 0
```

est affiché sous zéro.

Cette convention permet d'avoir une lecture intuitive :

```text
        EXPORT
           ↑
           │
───────────┼───────────
           │
           ↓
        IMPORT
```

---

# 10. Phase 1 — Synchronisation des graphiques

Les deux graphiques doivent partager le même axe temporel.

Lorsqu'un utilisateur déplace le curseur sur le graphique principal :

```text
14:37
```

le graphique réseau doit automatiquement se positionner sur le même instant.

Exemple conceptuel :

```text
Graphique 1
───────────────────────┼──────────────
                     14:37


Graphique 2
───────────────────────┼──────────────
                     14:37
```

Cette fonctionnalité est importante car elle sera également nécessaire dans la future carte Lovelace.

---

# 11. Phase 1 — Navigation

Le viewer doit permettre au minimum :

- affichage de la journée complète ;
- zoom horizontal ;
- retour à la vue complète ;
- déplacement du curseur ;
- tooltip ;
- synchronisation entre les deux graphes.

Une navigation plus élaborée pourra être ajoutée ultérieurement.

Il n'est pas nécessaire de construire dès la phase 1 toute la logique d'historique de la phase 2.

---

# 12. Phase 1 — Interface

L'interface doit rester sobre.

Elle doit notamment afficher :

- titre ;
- période visualisée ;
- légende ;
- unités ;
- état de chargement ;
- message d'erreur si `/simulation/day` est inaccessible.

Le viewer est avant tout un **outil de compréhension et de développement**, pas encore une interface utilisateur finale Home Assistant.

---

# 13. Phase 1 — Intégration Rust

Le serveur Rust doit servir le frontend.

Le principe souhaité est :

```text
Browser
   │
   ├── GET /
   │      └── index.html
   │
   ├── GET /style.css
   │
   ├── GET /viewer.js
   │
   ├── GET /lib/...
   │
   └── GET /simulation/day
```

Ainsi, le viewer n'a pas besoin d'un serveur frontend séparé.

Il est distribué avec le simulateur.

---

# 14. Phase 1 — Tests

Les tests doivent couvrir au minimum :

## Données

- 1440 échantillons ;
- premier échantillon à `00:00` ;
- dernier échantillon à `23:59` ;
- timestamps dans le bon ordre.

## Transformation

Vérifier :

```text
gridImport = max(gridPower, 0)
gridExport = max(-gridPower, 0)
solarToLoad = min(solar, consumption)
```

et :

```text
consumption = solarToLoad + gridImport
```

## Rendu

Vérifier manuellement :

- production nulle la nuit ;
- production maximale autour du milieu de journée ;
- consommation présente jour et nuit ;
- import lorsque la production solaire est insuffisante ;
- export lorsque la production dépasse la consommation ;
- cohérence des deux graphes.

## Interaction

Vérifier :

- zoom ;
- reset ;
- tooltip ;
- curseur synchronisé ;
- redimensionnement de la page.

---

# 15. Critères d'acceptation de la phase 1

La phase 1 est considérée comme terminée lorsque :

- [ ] le viewer est accessible depuis le simulateur ;
- [ ] aucune installation Node/npm n'est nécessaire ;
- [ ] `/simulation/day` est utilisé comme source ;
- [ ] les 1440 points sont correctement représentés ;
- [ ] les cinq séries énergétiques nécessaires sont disponibles ;
- [ ] le graphique principal montre production et consommation ;
- [ ] la consommation est décomposée entre solaire direct et réseau ;
- [ ] le graphique réseau montre export/import ;
- [ ] les deux graphiques partagent la même échelle temporelle ;
- [ ] le curseur est synchronisé ;
- [ ] le zoom fonctionne ;
- [ ] la vue complète peut être restaurée ;
- [ ] les erreurs de chargement sont gérées ;
- [ ] le renderer ne contient aucune logique spécifique à Fronius ;
- [ ] le code est suffisamment découplé pour permettre son utilisation avec une autre source de données.

---

# 16. Livrable de la phase 1

À la fin de la phase 1, on doit disposer de :

```text
Viewer du simulateur
        │
        ├── Data Adapter Simulator
        │
        ├── modèle énergétique normalisé
        │
        └── Energy Chart Renderer
                │
                └── uPlot
```

Le point important n'est donc pas seulement d'avoir « une jolie page ».

Le livrable doit fournir une **première implémentation du composant graphique réutilisable**.

---

# 17. Phase 2 — Custom Lovelace Card temps réel

## 17.1 Objectif

À partir de la brique produite en phase 1, développer une **custom Lovelace card** permettant d'afficher les mêmes informations à partir des données réelles de Home Assistant.

La carte devra notamment permettre :

- affichage temps réel ;
- historique ;
- zoom ;
- changement de plage temporelle ;
- synchronisation des graphes ;
- navigation dans le passé ;
- retour au temps réel.

Le simulateur ne doit plus être nécessaire au fonctionnement de cette phase.

---

# 18. Principe architectural de la phase 2

La partie commune doit rester :

```text
             modèle normalisé
                    │
                    ▼
              EnergyChart
                    │
                   uPlot
```

Seul l'adaptateur change.

Phase 1 :

```text
/simulation/day
      │
      ▼
SimulatorDataAdapter
```

Phase 2 :

```text
Home Assistant
      │
      ▼
HomeAssistantDataAdapter
```

Les deux produisent exactement le même modèle.

---

# 19. Stabilisation du composant commun

Avant de développer la carte Lovelace, il faut stabiliser l'API du composant graphique.

Une API conceptuelle pourrait être :

```javascript
chart.setData(data);

chart.appendData(data);

chart.setRange(start, end);

chart.resetRange();

chart.destroy();
```

L'API exacte reste à définir pendant l'implémentation.

Le but est que le composant graphique ne sache pas si les données viennent :

- du simulateur ;
- de Home Assistant ;
- d'un fichier ;
- d'une autre API.

---

# 20. Adaptateur Home Assistant

Il faudra ensuite définir précisément les données HA nécessaires.

Les entités devront permettre d'obtenir :

```text
production solaire
consommation
import réseau
export réseau
```

Certaines séries pourront être fournies directement par HA.

D'autres pourront être dérivées.

Cette décision doit être prise à partir des entités réellement disponibles dans l'installation cible, et non supposée à l'avance.

---

# 21. Résolution temporelle

La phase 2 devra définir une stratégie pour les données historiques.

Il faudra notamment décider :

- résolution native des données ;
- résolution affichée ;
- agrégation ;
- resampling ;
- comportement lorsque l'historique contient beaucoup de points.

Exemple :

```text
1 heure      → données fines
6 heures     → données fines ou agrégées
24 heures    → données agrégées si nécessaire
7 jours      → données agrégées
```

La stratégie exacte sera définie pendant la phase 2 en fonction des données réellement accessibles via Home Assistant.

---

# 22. Temps réel

La carte devra pouvoir recevoir de nouvelles valeurs sans reconstruire inutilement tout le graphique.

Conceptuellement :

```text
Historique
─────────────────────────────────┐
                                 │
                                 ▼
                           nouveau point
                                 │
                                 ▼
                         appendData(...)
```

Le composant devra également gérer :

- perte temporaire de données ;
- entités indisponibles ;
- valeurs manquantes ;
- données arrivant avec retard ;
- éventuelles corrections historiques.

---

# 23. Navigation temporelle de la carte

La carte devra proposer des plages prédéfinies, par exemple :

```text
[ 1 h ] [ 6 h ] [ 24 h ] [ 7 j ]
```

et éventuellement :

```text
[ plage personnalisée ]
```

La navigation doit être indépendante de la source de données.

Le renderer reçoit simplement :

```text
start timestamp
end timestamp
```

et affiche la portion correspondante.

---

# 24. Mode temps réel

La carte doit avoir une notion explicite de mode temps réel.

Exemple :

```text
                    MODE TEMPS RÉEL
                           ↓
                         NOW
```

Si l'utilisateur navigue dans le passé :

```text
                  historique sélectionné
                           ↓
                        14:00
```

la carte ne doit pas nécessairement forcer immédiatement la vue sur `now`.

L'utilisateur doit pouvoir revenir explicitement au temps réel.

Conceptuellement :

```text
[ Maintenant ] [ 1 h ] [ 6 h ] [ 24 h ] [ 7 jours ]
```

---

# 25. Synchronisation des graphes en phase 2

La synchronisation développée en phase 1 doit être conservée.

Les deux graphiques doivent toujours représenter le même intervalle :

```text
Graphique principal
───────────────────┼────────────────
                 14:37


Graphique réseau
───────────────────┼────────────────
                 14:37
```

Le zoom sur l'un doit pouvoir modifier la plage de l'autre.

---

# 26. Intégration Lovelace

La custom card doit fournir une interface de configuration permettant notamment de définir :

- entités utilisées ;
- historique ;
- plage initiale ;
- options d'affichage.

La configuration exacte reste volontairement à définir après identification des données HA disponibles.

La carte doit respecter :

- cycle de vie Lovelace ;
- redimensionnement ;
- thèmes clair/sombre ;
- dimensions variables ;
- destruction propre des abonnements et ressources.

---

# 27. Gestion des performances

La phase 2 doit prendre en compte le fait qu'un historique HA peut contenir beaucoup plus de données qu'une journée de 1440 points.

Il faudra notamment éviter :

```text
historique important
       ↓
des dizaines / centaines de milliers de points
       ↓
rendu inutilement coûteux
```

La stratégie pourra combiner :

- limitation de la quantité de données transférées ;
- agrégation ;
- resampling ;
- chargement progressif ;
- mise à jour incrémentale.

La décision précise doit être prise après mesure sur les données réelles.

---

# 28. Critères d'acceptation de la phase 2

La phase 2 sera considérée comme terminée lorsque :

- [ ] la carte fonctionne sans le simulateur ;
- [ ] elle fonctionne dans Lovelace ;
- [ ] les données HA sont transformées vers le modèle commun ;
- [ ] les deux graphiques sont affichés ;
- [ ] les graphes restent synchronisés ;
- [ ] les données temps réel sont mises à jour ;
- [ ] l'historique est disponible ;
- [ ] le zoom fonctionne ;
- [ ] plusieurs plages temporelles sont disponibles ;
- [ ] l'utilisateur peut revenir au temps réel ;
- [ ] les données manquantes sont gérées ;
- [ ] les performances restent acceptables sur un historique important ;
- [ ] le renderer développé en phase 1 est réutilisé ;
- [ ] aucune duplication de la logique énergétique n'est introduite dans la carte.

---

# 29. Livrable de la phase 2

Le résultat final doit être :

```text
Custom Lovelace Card
        │
        ├── Home Assistant Data Adapter
        │
        ├── modèle énergétique commun
        │
        └── Energy Chart Renderer
                │
                └── uPlot
```

Le viewer du simulateur doit continuer à fonctionner :

```text
Simulator
    │
    └── Simulator Data Adapter
              │
              └── même Energy Chart Renderer
```

---

# 30. Ordre recommandé de développement

L'ordre suivant est recommandé pour éviter de construire trop tôt des abstractions inutiles.

## Phase 1

```text
1. Définir le modèle normalisé
        ↓
2. Écrire l'adaptateur Simulator
        ↓
3. Intégrer uPlot
        ↓
4. Développer le renderer générique
        ↓
5. Construire le premier graphique
        ↓
6. Construire le graphique réseau
        ↓
7. Synchroniser les graphiques
        ↓
8. Ajouter zoom / tooltip / reset
        ↓
9. Servir le viewer depuis Rust
        ↓
10. Tester et stabiliser
```

## Phase 2

```text
1. Stabiliser l'API du renderer
        ↓
2. Identifier précisément les données HA
        ↓
3. Développer HomeAssistantDataAdapter
        ↓
4. Ajouter historique
        ↓
5. Ajouter temps réel
        ↓
6. Ajouter navigation temporelle
        ↓
7. Ajouter mode "maintenant"
        ↓
8. Encapsuler dans une custom Lovelace card
        ↓
9. Tester performances / données manquantes
        ↓
10. Finaliser l'intégration Lovelace
```

---

# 31. Ce qui doit rester commun entre les deux phases

Ces éléments doivent idéalement être développés une seule fois :

```text
Modèle énergétique
        │
        ├── calcul solarToLoad
        ├── calcul gridImport
        ├── calcul gridExport
        └── validation de cohérence
```

et :

```text
Energy Chart Renderer
        │
        ├── graphique principal
        ├── graphique réseau
        ├── axe temporel
        ├── tooltip
        ├── curseur
        ├── synchronisation
        └── zoom
```

---

# 32. Ce qui doit rester spécifique à chaque source

### Simulateur

```text
SimulatorDataAdapter
        │
        └── /simulation/day
```

### Home Assistant

```text
HomeAssistantDataAdapter
        │
        ├── entités HA
        ├── historique
        └── temps réel
```

Ces deux couches ne doivent pas contaminer le renderer.

---

# 33. Décisions volontairement reportées

Certaines décisions ne doivent pas être prises prématurément.

Notamment :

- noms définitifs des entités Home Assistant ;
- mécanisme exact de récupération de l'historique HA ;
- résolution historique ;
- stratégie de resampling ;
- fréquence de rafraîchissement ;
- configuration complète de la future carte ;
- mécanisme de distribution de la custom card ;
- fonctionnalités graphiques supplémentaires.

Ces sujets appartiennent principalement à la phase 2.

---

# 34. Principe directeur du projet

Le viewer de phase 1 ne doit **pas** être considéré comme un prototype jetable.

Il constitue la première implémentation d'une brique plus générale :

```text
        données énergétiques
                │
                ▼
       modèle normalisé
                │
                ▼
       Energy Chart Renderer
                │
                ▼
              uPlot
```

La phase 1 valide cette architecture avec le simulateur.

La phase 2 remplace simplement la source :

```text
Simulator
    ↓
Simulator Adapter
    ↓
       ┌────────────────────┐
       │ modèle normalisé   │
       └─────────┬──────────┘
                 ↓
          Energy Renderer
                 ↓
               uPlot
```

par :

```text
Home Assistant
    ↓
HA Adapter
    ↓
       ┌────────────────────┐
       │ modèle normalisé   │
       └─────────┬──────────┘
                 ↓
          Energy Renderer
                 ↓
               uPlot
```

**C'est cette séparation qui doit guider toutes les décisions d'implémentation.**