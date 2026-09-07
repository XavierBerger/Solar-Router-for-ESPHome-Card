# Solar Router Card — plan de développement

## Contexte

Aujourd'hui un utilisateur de *Solar Router for ESPHome* doit construire son tableau de bord à la
main : l'intégration ESPHome expose une trentaine d'entités brutes dont la composition dépend
entièrement des packages qu'il a assemblés (moteur, compteur d'énergie, limiteur de température,
planificateurs…). Le seul « dashboard » du projet est une capture d'écran dans la documentation
(`docs/images/SolarRouterInHomeAssistantDashboard.png`).

Objectif : une **carte Lovelace unique** que l'utilisateur ajoute en choisissant son routeur, qui
**reconnaît les modules réellement présents** sur ce device et n'affiche que les contrôles
correspondants, avec une visualisation temps réel en tête et une section **Avancé** repliée pour les
réglages fins et les diagnostics.

Décisions arrêtées :

| Sujet | Décision |
|---|---|
| Dépôt | `hacf-fr/Solar-Router-for-ESPHome-Card`, élément `custom:solar-router-card` |
| Backend | **aucun** — tout passe par l'objet `hass`. Rien à installer côté serveur, mise à jour HACS en un fichier, aucun couplage de version entre la carte et une intégration |
| Stack | **TypeScript + Lit**, composants HA natifs (`ha-form`, `ha-control-slider`, `ha-selector`, device picker) : thème, accessibilité et traductions hérités gratuitement |
| Découpage | **une seule carte polymorphe** — une entrée dans le sélecteur, une configuration à comprendre |
| Détection | **introspection des entités** — fonctionne avec tous les routeurs déjà flashés, sans `refresh` de package ni reflash |
| Langues | **anglais + français**, choix automatique d'après le profil HA, repli anglais |
| Dev/test | **Docker HA + fixtures + Playwright** |
| Licence | **GPL-3.0**, comme le dépôt firmware |

---

## 1. Le contrat de détection

`AGENTS.md` du dépôt firmware déclare les `id:` **et** les `name:` des packages comme API publique.
C'est cette garantie qui rend l'introspection fiable plutôt qu'approximative.

**Clé de correspondance : `(domaine, original_name)`.** `original_name` est le `name:` ESPHome
verbatim (`"Activate Solar Routing"`, `"Target grid exchange"`, `"Safety limit reached"`…) :

- il survit au renommage de l'`entity_id` et du *friendly name* par l'utilisateur, ce qui arrive
  couramment ;
- c'est aussi le seul point d'accroche des entités déclarées **sans `id:`** — `Restart`,
  `Uptime Sensor`, `Safety limit reached`, `Used for cooling`, tout `debug_sensors.yaml` ;
- le domaine fait partie de la clé parce que quelques noms sont réutilisés d'un domaine à l'autre.

Procédure :

1. `device_id` (config de la carte) → filtrer `hass.entities` sur `device_id` ;
2. `hass.callWS({ type: "config/entity_registry/list" })` une fois, mis en cache, pour récupérer
   `original_name` ;
3. repli sur le suffixe slugifié de l'`entity_id` si `original_name` est vide ;
4. construire un `RouterProfile` : rôles résolus → `entity_id`, plus la liste des modules reconnus.

### Table de détection

**Nature du device**

| Signal | Conclusion |
|---|---|
| switch `Activate Solar Routing` | routeur complet (un moteur est présent) |
| `Real Power` sans `Activate Solar Routing` | **proxy / compteur seul** → carte en mode réduit |
| aucun `Real Power` | device hors périmètre → message explicite dans l'éditeur |

**Moteur** — tester dans cet ordre, le premier qui matche gagne :

| Signal | Moteur |
|---|---|
| sensor `Relay 3 Countdown` | `engine_1dimmer_2switches_1bypass` |
| sensors `Relay 1 Countdown` + `Relay 2 Countdown` | `engine_1dimmer_2switches` |
| binary_sensor `Bypass Relay` | `engine_1dimmer_1bypass` |
| number `Start power level` | `engine_1switch` (tout ou rien) |
| number `Target grid exchange` | `engine_1dimmer` |
| aucun | moteur inconnu → rendu générique des entités trouvées |

**Autres modules**

| Signal | Module |
|---|---|
| `Total energy diverted` + number `Load power` | `energy_counter_theorical` |
| `Total daily energy diverted` | `energy_counter_jsy-mk-194t` |
| `safety_temperature` + `Safety limit reached` + `Stop temperature` + `Restart temperature` | un `temperature_limiter_*` |
| `Temperature to start fan` + `Temperature to stop fan` | `temperature_fan_control` |
| regex `^(.*) Scheduler Router Level$` | un `scheduler_forced_run` **par capture** — à énumérer, jamais coder en dur (`scheduler_unique_id` vaut `Forced` par défaut) |
| `EM3 Phase A Active Power` | `power_meter_shelly_em3` |
| `Active Power Ch2` / `Voltage Ch1` / `Power Direction Ch2` | `jsy-mk-194t_common` chargé |
| switch `Restart` + `Uptime Sensor` | `common.yaml` |
| `Device Info` + `Free PSRAM` | `debug_sensors.yaml` |

### Ce que la carte laisse volontairement de côté

L'information n'existe pas côté Home Assistant : la carte affiche ce qu'elle sait et se tait sur le
reste plutôt que de deviner.

- **La saveur de régulateur.** `regulator_triac`, `regulator_solid_state_relay` et
  `regulator_mecanical_relay` n'exposent aucune entité. Seul le *nombre* de relais mécaniques se
  déduit, des sensors `Relay N Countdown`.
- **Dallas vs Home Assistant** pour le limiteur de température : les deux publient
  `safety_temperature`, et les contrôles sont identiques de toute façon — rien n'est perdu.
- **Fronius vs proxy_client vs home_assistant** : tous convergent sur `Real Power` / `Consumption`,
  qui est précisément ce que la carte affiche.

Si l'identification exacte devient utile, la bonne correction est en amont
(`esphome: project:` dans `common.yaml`), pas une heuristique plus astucieuse ici.

### Propriétés du firmware à encoder dans le catalogue

Ce sont elles qui font que la carte marche sur les installations réelles et pas seulement sur le
chemin heureux.

1. **Dégradation gracieuse.** Chaque rôle est optionnel. Une entité absente n'est jamais une erreur
   ni une section vide : la section ne se rend pas, c'est tout.
2. `hide_regulators` et `hide_leds` valent `"True"` par défaut : le **même moteur** peut présenter
   trois jeux d'entités. L'absence de `Regulator Opening` n'apprend rien sur le moteur.
3. `Regulator Opening` **change de domaine** : `number` dans `engine_1dimmer`
   (`solar_router/engine_1dimmer.yaml:68`), `sensor` dans les trois autres moteurs à dimmer. Le
   chercher dans les deux domaines et rendre éditable ou lecture seule en conséquence — c'est une
   fonctionnalité, le moteur à dimmer permettant réellement de piloter le régulateur à la main.
4. Des noms sont partagés entre domaines : `Start tempo` et `Stop tempo` existent en `number` *et* en
   `sensor` (consigne et décompte), `Bypass tempo` aussi (`full_power_duration` vs
   `bypass_tempo_counter`). Les apparier dans l'UI : la consigne et son décompte vont ensemble.
5. `Energy divertion Realy 3 Bypass` contient une typo, et cette typo fait partie de l'API publique.
   La matcher telle quelle — la corriger en amont casserait toutes les installations existantes.
6. Les unités varient d'un package à l'autre : `"w"` minuscule sur `stop_power_level`,
   `unit_of_measurement: ""` sur les réactivités, `device_class: duration` sans unité sur
   `Relay N Countdown`. La carte impose son propre libellé par rôle, ce qui permet au passage des
   unités cohérentes et traduites.
7. `safety_temperature` est le seul nom non capitalisé.
8. `Used for cooling` compile en `ALWAYS_OFF` : il retombe à OFF après un redémarrage. Le signaler
   dans l'UI pour que le comportement soit compris plutôt que découvert.
9. `em3_phase_a/b/c_power` sont **visibles** par défaut (`show_phase_power` alimente directement
   `internal:`, donc `"False"` ⇒ visible). Les attendre, et les placer dans les diagnostics.
10. Les planificateurs sont multi-instances par conception : les énumérer et rendre un repli par
    instance.

---

## 2. UX / UI

Une carte, quatre zones, dont la troisième et la quatrième sont composées à partir des modules
reconnus.

```
┌────────────────────────────────────────────────┐
│ SolarRouter                    ● en ligne  [ ⏻ ]│  en-tête + interrupteur principal
├────────────────────────────────────────────────┤
│   ┌──────────┐   Réseau   ← 1 240 W export     │  bandeau live
│   │   68 %   │   Charge    → 1 700 W           │
│   │  routage │   Cible         0 W             │
│   └──────────┘   Aujourd'hui  4,21 kWh         │
│  ⚠ Limite de sécurité atteinte — 62 °C         │  bandeau d'alerte conditionnel
│  🕑 Forcé actif jusqu'à 02:00                   │
├────────────────────────────────────────────────┤
│ Routage                                        │  contrôles par module
│   Niveau du routeur      ▓▓▓▓▓▓▓░░░  68 %      │
│   Échange réseau cible   [    0 W ]            │
│ Température                                    │
│   Arrêt / Redémarrage    [ 50 ] [ 40 ] °C      │
│   Usage refroidissement  [ ○ ]                 │
│ Planificateur « Forcé »                    ⌄   │
├────────────────────────────────────────────────┤
│ ⌄ Avancé                                       │  repliée par défaut
└────────────────────────────────────────────────┘
```

**Zone 1 — en-tête.** Nom du device (ou override), pastille de disponibilité, et le switch
`Activate Solar Routing` comme affordance principale.

**Zone 2 — live.** Jauge de niveau de routage (0–100 %) ; lecture `Real Power` avec sens et couleur
(import / export) ; `Consumption` ; `Power divertion` en W ; `Total (daily) energy diverted` ; bandeau
rouge si `Safety limit reached` est `on` (avec `safety_temperature`) ; bandeau d'information si une
fenêtre de planificateur est ouverte. Pour le moteur tout-ou-rien, la jauge devient un indicateur
binaire et les compteurs `Start tempo` / `Stop tempo` s'affichent en décompte.

**Zone 3 — contrôles**, sections rendues seulement si le module est reconnu :

| Section | Entités |
|---|---|
| Routage (progressif) | `Router Level`, `Target grid exchange` |
| Routage (tout ou rien) | `Router Level` (pas 100), `Start power level`, `Start tempo`, `Stop power level`, `Stop tempo` |
| Bypass | `Bypass tempo` (number) |
| Compteur d'énergie | `Load power` |
| Température | `Stop temperature`, `Restart temperature`, `Used for cooling` |
| Ventilateur | `Temperature to start fan`, `Temperature to stop fan` |
| Planificateur × N | `Activate <X> Scheduler`, début et fin rendus comme deux sélecteurs d'heure (paires heure+minute fusionnées), `<X> Scheduler Router Level`, `<X> Scheduler Checking End Threshold` |

Détail issu de `docs/en/solar_router.md` : quand le routage est **actif**, `Router Level` est écrasé en
continu par l'algorithme. Le slider reste manipulable mais la carte affiche une note explicite et le
présente comme « piloté » ; il redevient pleinement manuel quand `activate` est `off`.

**Zone 4 — Avancé** (repliée, état mémorisé) : `Up Reactivity`, `Down Reactivity`,
`Regulator Opening`, les switches `Energy divertion*`, les lights `Green Led` / `Yellow Led`, les
`Relay N Countdown`, le bouton `Restart`, puis un bloc *Diagnostics* (`Uptime Sensor`, `Device Info`,
heap, PSRAM, phases EM3, sensors JSY).

**Soin visuel :** variables de thème HA uniquement (`--ha-card-background`, `--primary-text-color`,
`--primary-color`, `--error-color`, `--state-icon-color`…) pour respecter clair, sombre et thèmes
personnalisés ; jauge en SVG inline (aucune dépendance graphique) ; grille responsive qui passe en une
colonne sous 450 px ; états `unavailable` / `unknown` rendus explicitement plutôt qu'en `—` muet.

### Configuration de la carte

```yaml
type: custom:solar-router-card
device_id: 3f8a…            # requis — ha-device-picker filtré sur l'intégration esphome
name: Chauffe-eau           # optionnel, override du titre
advanced_open: false        # état initial de la section Avancé
sections:                   # optionnel : auto | show | hide par section
  live: auto
  diagnostics: hide
entities: {}                # optionnel : override rôle → entity_id pour installations exotiques
```

L'éditeur GUI est un `ha-form` avec un `device` selector (`integration: esphome`). Après sélection il
affiche un **récapitulatif des modules reconnus** : c'est le retour visuel qui montre à l'utilisateur
que la carte a bien identifié son routeur.

---

## 3. Structure du dépôt

```
Solar-Router-for-ESPHome-Card/
├── AGENTS.md                      contrat d'ingénierie (déjà écrit)
├── plan/PLAN.md                   ce document
├── LICENSE                        GPL-3.0
├── hacs.json                      {"name","filename":"solar-router-card.js","render_readme":true}
├── package.json  tsconfig.json  rollup.config.mjs  eslint/prettier
├── src/
│   ├── solar-router-card.ts       l'élément, window.customCards, getCardSize
│   ├── editor.ts                  éditeur GUI (ha-form + device picker)
│   ├── detect/
│   │   ├── catalog.ts             rôle → (domaine, original_name, kind, unité) — LA table du §1
│   │   ├── detect.ts              device_id → RouterProfile
│   │   └── types.ts               RouterProfile, Role, ModuleId
│   ├── sections/                  live, routing, onoff, bypass, energy, temperature, fan,
│   │                              scheduler, advanced, diagnostics
│   ├── components/                gauge.ts, power-flow.ts, number-row.ts, switch-row.ts,
│   │                              time-window.ts, alert-banner.ts
│   ├── localize/                  en.json, fr.json, localize.ts
│   └── styles.ts
├── test/
│   ├── fixtures/                  un JSON par combinaison réelle (voir §4)
│   └── unit/                      detect.spec.ts, sections.spec.ts (Vitest)
├── tests/browser/                 Playwright : smoke shadow-root, chargement sous HA
├── dev/
│   ├── docker-compose.yml         service homeassistant + build en watch
│   ├── dev-up.sh / dev-down.sh / build-card.sh
│   ├── dump-device.mjs            capture une fixture depuis un HA réel
│   ├── demo-entry.ts              build de dev qui embarque les fixtures (`demo: <fixture>`)
│   └── homeassistant/config/      configuration.yaml (lovelace yaml + resource /local/),
│                                  ui-lovelace.yaml, www/.gitkeep
├── .github/workflows/ci.yml       lint + typecheck + vitest + build + playwright
├── .github/workflows/release.yml  attache dist/solar-router-card.js à la release GitHub
└── README.md  CHANGELOG.md
```

HACS « plugin » attend le JS construit dans la release ou dans `dist/` : `release.yml` publie
l'artefact, et comme la carte est un **unique fichier JavaScript sans binaire annexe**, le modèle
`filename` de `hacs.json` suffit — installation et mise à jour en un fichier.

### Règles d'intégration Home Assistant

- Rendu **dans le shadow root** de l'élément — Lit le fait nativement ; garder le test Playwright qui
  l'affirme pour que la garantie reste vérifiée.
- HA sert `/local/` avec un cache d'un mois : garder un `?v=` incrémentable sur l'URL de ressource
  Lovelace pendant le développement pour voir ses changements immédiatement.
- Nom du fichier de sortie **stable** (pas de hash) : l'URL de ressource configurée par l'utilisateur
  doit continuer à fonctionner après mise à jour.
- Servir depuis `/local/` en développement : same-origin, exactement comme une installation HACS, donc
  ce qu'on teste est ce que l'utilisateur obtient.
- « Ça se rend dans une page de dev » et « ça marche dans Home Assistant » sont deux affirmations
  distinctes : vérifier les deux (voir les niveaux de test).

---

## 4. Fixtures — le socle des tests

Les 14 configs racine du dépôt firmware donnent les combinaisons réelles à couvrir. Une fixture = un
JSON `{ device, entities: [{entity_id, domain, original_name, state, attributes}] }`.

| Fixture | Dérivée de |
|---|---|
| `engine_1dimmer_fronius` | `esp32-standalone.yaml` |
| `engine_1dimmer_2switches` | `esp32-standalone_1dimmer_2switches.yaml` |
| `engine_1dimmer_2switches_1bypass` | `esp32-standalone_1dimmer_2switches_1bypass.yaml` |
| `engine_1dimmer_ds18b20_counter` | `esp32-standalone_DS18B20.yaml` |
| `engine_1dimmer_scheduler` | `esp32-standalone_shedule_forced_run.yaml` |
| `engine_1dimmer_scheduler_x2` | la variante `day`/`night` commentée dans ce même fichier |
| `engine_1dimmer_em3` | `esp32-em3-router.yaml` (phases visibles) |
| `engine_1dimmer_jsy_debug` | `esp32-JSY-MK-194T.yaml` |
| `engine_1dimmer_1bypass` | `esp8266-proxy-client.yaml` (sans `common.yaml`) |
| `engine_1switch_ha_limiter` | `esp8266-standalone_on_off.yaml` |
| `proxy_only` | `esp8285-power-meter-proxy.yaml` |
| `engine_1dimmer_fan` | `wt32-eth01-solar-water-heater.yaml` |
| `regulators_unhidden` | variante avec `hide_regulators: "False"` + `hide_leds: "False"` |
| `unavailable` | toutes entités `unavailable` (device hors ligne) |

Deux voies complémentaires pour les produire :

1. `dev/dump-device.mjs` — script Node qui interroge un HA réel (URL + token long terme en variables
   d'environnement) et écrit la fixture d'un device donné. C'est ce qui ancre les fixtures dans la
   réalité.
2. Écriture à la main pour les combinaisons dont on ne possède pas le matériel, à partir de
   l'inventaire des packages.

Les mêmes fixtures alimentent Vitest (détection et rendu) et le build de démo chargé par Playwright et
par le dashboard de développement — ce qui donne un HA de dev pleinement utilisable sans matériel. Les
fixtures ne sont **pas** embarquées dans le bundle de production (entrée séparée `dev/demo-entry.ts`).

---

## 5. Documentation

Dans le **dépôt firmware**, ajouter une page sous la section existante `Home Assistant:` :

- `docs/en/card.md` et `docs/fr/card.md` (parité fichier-pour-fichier imposée par
  `docs_structure: folder`) ;
- l'entrée `nav:` dans `mkdocs.yml` (indentation 6 / 14 espaces à respecter) ;
- l'entrée `nav_translations` pour le titre `Card` → `Carte`.

Contraintes CI du dépôt firmware à respecter :

- **aucun nouveau `*.yaml` à la racine** — `esphome-ci.yaml` fait `ls *.yaml` et l'injecte dans la
  matrice de build firmware ;
- **rien de nouveau dans `solar_router/`** — `check_build_coverage.sh` itère `ls solar_router/*` et
  échoue sur tout fichier non référencé ;
- `mkdocs build --strict` : zéro lien cassé ;
- titre de PR conventional-commit (`docs(card): …`).

Ce dépôt a son propre `README.md`, rendu par HACS : capture d'écran, installation, options de
configuration, tableau des modules reconnus.

---

## 6. Phases

| # | Contenu | Fin de phase |
|---|---|---|
| 1 | Squelette du dépôt, build Rollup, `hacs.json`, harnais Docker HA, carte « hello » enregistrée dans `window.customCards` | la carte s'affiche dans un vrai HA depuis `/local/`, visible dans le sélecteur de cartes |
| 2 | `detect/catalog.ts` + `detect.ts` + les 14 fixtures + Vitest | `RouterProfile` correct sur les 14 fixtures, y compris multi-planificateurs et `unavailable` |
| 3 | Sections de contrôle, éditeur GUI avec récapitulatif des modules, i18n en/fr | toutes les variables modifiables de chaque module sont exposées et écrivent bien via `hass.callService` |
| 4 | Bandeau live : jauge, flux réseau/charge, énergie du jour, alertes sécurité et planificateur | rendu correct pour moteur progressif **et** tout-ou-rien |
| 5 | Finition (thème, responsive, a11y, états indisponibles), Playwright, docs bilingues, `release.yml`, soumission HACS | CI verte, validation sur routeurs réels, dépôt prêt pour HACS |

---

## Vérification

**Unitaire / détection** — `npm test` : pour chaque fixture, assertion sur le `RouterProfile` attendu
(moteur identifié, modules présents ou absents, instances de planificateur énumérées, rôles résolus
vers le bon `entity_id`). Cas négatifs faisant partie de la suite : `Regulator Opening` en `sensor` vs
`number`, la paire `Start tempo` number/sensor, absence totale de `Regulator Opening`, device proxy
sans moteur, device non-routeur.

**Rendu** — Vitest + `@open-wc/testing-helpers` : monter la carte avec chaque fixture et vérifier
qu'aucune section non pertinente n'est rendue, et qu'une entité absente ne provoque jamais d'exception.

**Build** — `npm run build`, puis contrôle de la taille du bundle (objectif < 120 ko minifié) et
absence de fixture dans `dist/`.

**Navigateur sous HA** — `dev/dev-up.sh`, puis Playwright sur `http://localhost:8123` avec un dashboard
listant une carte par fixture via `demo:` ; assertions : l'élément est défini,
`setConfig` / `getCardSize` / `hass` présents, le rendu est **dans le shadow root**, `document.body` ne
contient pas de contenu parasite, zéro `pageerror`.

**Réel** — build copié dans le `/config/www` d'un HA de production, une carte par routeur physique :
vérifier la reconnaissance, puis modifier chaque contrôle et confirmer que l'état remonte bien côté
ESPHome (`esphome logs`). C'est le niveau qui valide `Used for cooling`, les LED et les relais.

**Docs** — dans le dépôt firmware : `mkdocs build --strict`,
`./tools/check_documentation_coverage.sh` et `./tools/check_build_coverage.sh` doivent rester verts.

---

## Amélioration possible, non bloquante

La reconnaissance repose sur l'inférence : le firmware n'expose aujourd'hui aucun identifiant
(`grep "project:"` sur tout le dépôt ne renvoie rien, et il n'existe pas de text_sensor de version),
et les noms de devices sont trop hétérogènes (`solarrouter-r`, `em3-router`, `esp8285`,
`wt32-eth01-2`…) pour servir de clé.

Ajouter plus tard un `esphome: project: {name: "hacf-fr.solar-router", version: …}` dans `common.yaml`
rendrait la reconnaissance exacte plutôt que déduite et lèverait les trois angles morts (saveur de
régulateur, Dallas vs HA, fronius vs proxy vs HA). C'est une évolution de l'API publique du dépôt
firmware, à traiter séparément — la carte fonctionne sans.
