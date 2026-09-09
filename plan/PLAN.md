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
| Détection | **déclarative** — chaque paquet du firmware publie un capteur de version, la carte les lit. Exige un `refresh` de package et un reflash |
| Langues | **anglais + français**, choix automatique d'après le profil HA, repli anglais |
| Dev/test | **Docker HA + fixtures + Playwright** |
| Licence | **GPL-3.0**, comme le dépôt firmware |

---

## 1. Le contrat de détection

La carte travaille à **deux niveaux**, qu'il ne faut jamais confondre :

| | Question | Mécanisme |
|---|---|---|
| **Modules** | de quels paquets ce routeur est-il fait ? | **déclaratif** — le firmware le dit |
| **Rôles** | quelle entité est `Router Level` ? | **`(domaine, original_name)`** |

### 1.1 Les modules — le firmware déclare sa composition

Chaque paquet `solar_router/*.yaml` du firmware se termine par un capteur de version : un
`text_sensor` template, `entity_category: diagnostic`, nommé d'après le paquet, publiant une version
semver nue.

```yaml
text_sensor:
  - platform: template
    id: version_engine_1dimmer          # version_ + nom du fichier, les « - » remplacés par « _ »
    name: "engine_1dimmer"              # le nom du fichier, verbatim
    icon: mdi:tag-outline
    entity_category: diagnostic
    update_interval: 10s
    lambda: |-
      static bool published = false;
      if (published) return {};
      published = true;
      return {"1.6.6"};
```

Côté Home Assistant : une entité de domaine **`sensor`** dont `original_name` **est** le nom du
paquet et dont l'état est la version. Énumérer ces entités donne la composition exacte du routeur —
plus aucune inférence.

Procédure :

1. `device_id` (config de la carte) → filtrer le registre sur `device_id` ;
2. retenir les entités `domain === "sensor"` **et** `entity_category === "diagnostic"` dont
   `original_name` figure au catalogue des paquets (comparaison insensible à la casse :
   `temperature_limiter_DS18B20`) ;
3. pour un paquet multi-instance, matcher le **préfixe** `<paquet>_` et garder le suffixe comme
   identifiant d'instance ;
4. lire la version dans l'état de l'entité.

**Présence et version viennent de sources différentes, et c'est ce qui rend la détection robuste.**
La présence est dans le *registre*, la version dans l'*état*. Le capteur ne publiant qu'une fois,
~10 s après le boot, son état est `unknown` d'ici là : un routeur à jour dont on ne connaît pas
encore les versions ne doit jamais être pris pour un firmware ancien.

Le verdict de compatibilité a donc **quatre** valeurs, pas deux — c'est la résolution des rôles
(§1.2) qui départage les trois cas sans capteur de version :

| Capteurs de version | Rôles d'ancrage résolus | Verdict | Rendu |
|---|---|---|---|
| ≥ 1 | — | `supported` | la carte |
| 0 | ≥ 1 (`activate`, `real_power`…) | `outdated` | « Mettez à jour vos paquets » |
| 0 | 0, mais des entités au registre | `not_a_router` | « Ce device n'est pas un routeur solaire » |
| 0 | **aucune** entité au registre | `unknown` | « Aucune entité pour ce device » + Recharger |

`unknown` est la valeur qui manque à un raisonnement binaire : un device tout juste ajouté, ou un
cache de registre lu avant sa première connexion, n'est pas un firmware ancien. Ne rien conclure est
la bonne réponse.

**Il n'existe aucun paquet d'ancrage universel.** `esp8266-proxy-client.yaml` ne charge pas
`common.yaml` ; `power_meter_common` manque sur les configs `power_meter_home_assistant`. Le test est
donc « *au moins un* capteur », jamais « *tel* capteur ».

Deux paquets `*_common` sont d'ailleurs des marqueurs peu fiables : `power_meter_common` et
`temperature_limiter_common` sont écrasés quand la feuille les inclut avec la clé de fusion
`<<: !include` au lieu de `packages:`. Détecter les modules par leurs paquets *feuilles*, et ne
jamais avertir de leur absence.

**Deux faux positifs à désamorcer dans le code**, tous deux dans `src/detect/registry.ts` :

- `loadDeviceEntities` filtre `disabled_by` : un utilisateur qui désactive ses entités de diagnostic
  verrait « mettez à jour » à tort. Remonter les entités désactivées au lieu de les jeter, et lui
  dire de les réactiver.
- `registryCache` n'est jamais invalidé tant que la page est ouverte : après un reflash, « mettez à
  jour » persisterait jusqu'au rechargement complet. `invalidateEntityRegistry()` existe déjà et
  n'a aucun appelant — le câbler à un bouton **Recharger** sur ces écrans.

### 1.2 Les rôles — `(domaine, original_name)`

`AGENTS.md` du dépôt firmware déclare les `id:` **et** les `name:` des packages comme API publique.
C'est cette garantie qui rend la résolution des rôles fiable plutôt qu'approximative.

**Clé de correspondance : `(domaine, original_name)`.** `original_name` est le `name:` ESPHome
verbatim (`"Activate Solar Routing"`, `"Target grid exchange"`, `"Safety limit reached"`…) :

- il survit au renommage de l'`entity_id` et du *friendly name* par l'utilisateur, ce qui arrive
  couramment ;
- c'est aussi le seul point d'accroche des entités déclarées **sans `id:`** — `Restart`,
  `Uptime Sensor`, `Safety limit reached`, `Used for cooling`, tout `debug_sensors.yaml` ;
- le domaine fait partie de la clé parce que quelques noms sont réutilisés d'un domaine à l'autre.

Procédure :

1. `hass.callWS({ type: "config/entity_registry/list" })` une fois, mis en cache, pour récupérer
   `original_name` ;
2. repli sur le suffixe slugifié de l'`entity_id` si `original_name` est vide ;
3. construire un `RouterProfile` : paquets déclarés + versions, et rôles résolus → `entity_id`.

### 1.3 Ce qui se déduit des paquets déclarés

| Information | Source |
|---|---|
| Moteur | le paquet `engine_*` déclaré, en ignorant `engine_common` qui accompagne toujours une feuille |
| Nature du device | un paquet `engine_*` → routeur ; seulement `power_meter_*` → proxy / compteur seul ; aucun paquet → hors périmètre |
| Régulateurs | `regulator_triac` / `regulator_solid_state_relay` / `regulator_mecanical_relay` — **une liste, jamais une valeur** : `esp8266-proxy-client.yaml` charge un relais statique *et* un relais mécanique, `esp32-standalone_1dimmer_2switches_1bypass.yaml` un triac *et* trois relais |
| Nombre de relais mécaniques | le nombre d'instances `regulator_mecanical_relay_*`. **À ne pas confondre** avec le nombre de `Relay N Countdown`, qui est autre chose : `esp8266-proxy-client.yaml` charge un relais mécanique alors que `engine_1dimmer_1bypass` ne publie aucun décompte. Deux grandeurs, deux champs |
| Source de mesure | `power_meter_fronius` / `_home_assistant` / `_proxy_client` / `_shelly_em` / `_shelly_em3` / `_jsy-mk-194t` |
| Sonde de température | `temperature_limiter_DS18B20` vs `temperature_limiter_home_assistant` |

Les planificateurs restent énumérés par la regex `^(.*) Scheduler Router Level$` sur les entités
métier : c'est `scheduler_unique_id` qui les nomme, et il n'y a pas de raison de coder ces noms en
dur.

### Les angles morts sont levés

Les trois zones d'ombre que la carte assumait tant que la détection était inférée — saveur de
régulateur, Dallas vs Home Assistant, Fronius vs proxy vs home_assistant — sont **résolues** par les
capteurs de version. Les trois familles concernées ne publiaient rien d'autre qui les distingue ;
elles se nomment désormais elles-mêmes.

C'est la correction « en amont » que ce document appelait de ses vœux, faite autrement que par le
`esphome: project:` qui y était suggéré : un capteur par paquet est plus informatif, puisqu'il donne
aussi la version de chacun.

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

Et, pour les capteurs de version :

11. **Publication unique.** La lambda a un garde `static bool published` : le capteur publie une
    fois ~10 s après le boot, puis se tait. L'état est `unknown` d'ici là, et ne se rafraîchit
    jamais ensuite. Ne jamais conclure « firmware ancien » depuis un état, seulement depuis
    l'absence de l'entité au registre.
12. **Préfixe multi-instance.** `regulator_mecanical_relay` porte
    `name: "regulator_mecanical_relay_${relay_unique_id}"`, et le défaut `relay_unique_id: ""`
    produit un nom terminé par un souligné. Matcher le préfixe, pas l'égalité.
13. **Le common voyage avec la feuille.** Un moteur inclut toujours `engine_common`, les paquets JSY
    toujours `jsy-mk-194t_common`. Un device expose donc les deux, et le moteur se lit de la
    feuille.
14. **Deux commons sont invisibles.** `power_meter_common` et `temperature_limiter_common` sont
    écrasés lorsque la feuille les inclut avec `<<: !include` — cas de
    `power_meter_home_assistant.yaml`, qui surcharge délibérément `real_power` et `consumption`.
    Leur absence n'apprend rien.
15. **Lire la version avec tolérance.** L'`AGENTS.md` du firmware décrit un format d'état différent
    de celui que son code publie : `<fichier>.yaml <version>` au lieu du semver nu. Le jour où
    quelqu'un alignera le code sur sa documentation, une carte qui exige un semver strict cassera
    chez tous les utilisateurs. Donc : semver nu d'abord, sinon extraction du premier semver trouvé
    dans la chaîne **plus** un avertissement de format visible dans l'éditeur, sinon version
    inconnue. Jamais un rejet du paquet, jamais une exception.

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
heap, PSRAM, phases EM3, sensors JSY) et un bloc **Modules**.

Le bloc *Modules* liste les paquets déclarés et leur version — c'est la matérialisation directe du
§1.1, et le même rendu sert de récapitulatif dans l'éditeur GUI. Il nomme aussi ce que la carte ne
savait pas dire avant : la saveur de régulateur, la source de mesure, la sonde de température.

Les versions sont affichées telles quelles, **sans minimum codé en dur et sans jugement** : un seuil
dans la carte recréerait exactement le couplage de version que la décision « aucun backend » écarte.

Et surtout, un écart de version entre paquets n'est **pas** une anomalie : `check_module_version.sh`
n'exige un incrément que sur les paquets *modifiés* depuis le dernier tag, donc des versions
hétérogènes sont le fonctionnement normal — `common` reste à 1.1.1 quand `temperature_fan_control`
est à 1.6.7, dans la même release. Signaler « en retard » les paquets sous la version la plus élevée
du device crierait au loup sur toutes les installations.

Corollaire à retenir : `max(versions)` est une **borne inférieure** de la release installée, jamais
la release. Au tag `v1.6.7`, `esp32-standalone.yaml` ne déclare au mieux que 1.6.6, aucun de ses
paquets n'ayant été touché en 1.6.7. D'où l'affichage « Paquets ≥ 1.6.6 », et pas « Version 1.6.7 ».

Une version pas encore publiée s'affiche « — », jamais comme une erreur. Le mécanisme d'un plancher
*par paquet* est prévu dans le catalogue mais **vide** : on y écrira une ligne le jour où une
évolution du firmware cassera réellement une hypothèse de la carte.

**État « firmware trop ancien ».** Si aucun paquet n'est déclaré, la carte ne rend ni contrôles ni
sections vides : elle affiche une invite à rafraîchir les paquets et reflasher, en nommant le device
concerné. C'est le seul cas où la carte refuse de s'afficher, et il est explicite.

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
│   │   ├── catalog.ts             rôle → (domaine, original_name, kind, unité) — la table du §1.2,
│   │   │                          et PACKAGES, le catalogue des paquets du §1.1
│   │   ├── registry.ts            lecture cachée de config/entity_registry/list
│   │   ├── detect.ts              device_id → RouterProfile
│   │   └── types.ts               RouterProfile, Role, PackageId, DeclaredPackage
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
- **Ne pas recalculer le profil à chaque changement d'état.** `Real Power` a un
  `update_interval: 1s` : l'objet `hass` change environ une fois par seconde et `updated()` est
  rappelé d'autant. La détection des paquets et la résolution des 63 rôles ne dépendent que du
  *registre* : les mémoïser par `device_id`, et ne lire que les versions au rendu. La séparation
  présence/version du §1.1 sert aussi à cela.

---

## 4. Fixtures — le socle des tests

Les 14 configs racine du dépôt firmware donnent les combinaisons réelles à couvrir. Une fixture = un
JSON `{ device, entities: [{entity_id, domain, original_name, entity_category, state, attributes}] }`.

`entity_category` fait désormais partie du format : c'est lui qui distingue un capteur de version
d'un sensor ordinaire. Chaque fixture porte les capteurs de version des paquets qu'elle représente —
ce n'est plus un détail de la fixture, c'en est l'information centrale.

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
| `firmware_legacy` | un routeur complet **sans aucun capteur de version** — verdict `outdated` |
| `versions_unpublished` | capteurs présents, tous les états à `unknown` (device fraîchement démarré) — doit rester `supported` |
| `versions_disabled` | `firmware_legacy` plus les mêmes capteurs en `disabled_by: "user"` — `outdated`, mais avec le message « réactivez-les » |
| `not_a_router` | un device ESPHome quelconque, aucun nom du catalogue — verdict `not_a_router` |
| `two_engines` | montage bricolé déclarant deux paquets `engine_*` — choix déterministe du plus spécifique, plus un avertissement |

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
| 2 | Détection déclarative (`PACKAGES`, `detectPackages`) + résolution des rôles + les 19 fixtures + Vitest | `RouterProfile` correct sur les 19 fixtures, y compris multi-instances, `unavailable`, et les quatre verdicts de compatibilité |
| 3 | Sections de contrôle, éditeur GUI avec récapitulatif des modules, i18n en/fr | toutes les variables modifiables de chaque module sont exposées et écrivent bien via `hass.callService` |
| 4 | Bandeau live : jauge, flux réseau/charge, énergie du jour, alertes sécurité et planificateur | rendu correct pour moteur progressif **et** tout-ou-rien |
| 5 | Finition (thème, responsive, a11y, états indisponibles), Playwright, docs bilingues, `release.yml`, soumission HACS | CI verte, validation sur routeurs réels, dépôt prêt pour HACS |

---

## Vérification

**Unitaire / détection** — `npm test` : pour chaque fixture, assertion sur le `RouterProfile` attendu
(paquets déclarés et leurs versions, moteur identifié, instances de planificateur énumérées, rôles
résolus vers le bon `entity_id`, `unclaimed` vide — toute entité non réclamée signale un trou du
catalogue).

Cas négatifs faisant partie de la suite :

- côté rôles — `Regulator Opening` en `sensor` vs `number`, la paire `Start tempo` number/sensor,
  absence totale de `Regulator Opening` (`hide_regulators` par défaut) ;
- côté paquets — `regulator_mecanical_relay_` avec suffixe vide, trois instances de relais,
  `temperature_limiter_DS18B20` en casse mixte, `power_meter_common` absent derrière un
  `<<: !include`, deux paquets `engine_*` (ambiguïté), device proxy sans moteur, device
  non-routeur, et les deux fixtures `firmware_legacy` / `versions_unpublished`.

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

## Historique de la décision de détection

La première version de ce plan détectait les modules par **inférence**, faute de mieux : le firmware
n'exposait aucun identifiant, et les noms de devices sont trop hétérogènes (`solarrouter-r`,
`em3-router`, `esp8285`, `wt32-eth01-2`…) pour servir de clé. Ce document notait alors, en
amélioration non bloquante, qu'un `esphome: project:` dans `common.yaml` rendrait la reconnaissance
exacte plutôt que déduite.

Le firmware a résolu le problème autrement, et mieux : **un capteur de version par paquet** plutôt
qu'un identifiant global. Plus informatif, puisqu'il donne aussi la version de chacun. C'est ce qui
fonde le §1.1, et ce qui a fait basculer la décision « fonctionne avec tous les routeurs déjà
flashés » en « exige un firmware à jour ».

### Ce qui reste possible, toujours non bloquant

- **`esphome: project: {name, version}`** garderait son intérêt : les capteurs de version donnent
  une version *par paquet*, jamais l'identité de la release installée — `max(versions)` n'en est
  qu'une borne inférieure. Un `project:` répondrait à « quelle version du projet tourne ici ? », à
  laquelle la carte ne sait aujourd'hui répondre qu'approximativement.
- **S'abonner à `entity_registry_updated`** plutôt que de mettre le registre en cache sans jamais
  l'invalider. Le bouton *Recharger* du §1.1 est la parade simple ; l'abonnement est la solution
  propre.
