#!/usr/bin/env python3
"""Regenerate test/fixtures/*.json from the firmware's own ESPHome configs.

`esphome config` expands every package and substitution, so the entity names it
prints are the ones a real router publishes -- version text_sensors included.
Deriving the fixtures from that output rather than writing them by hand is what
makes them evidence: a name the card matches on is a name the firmware really
emits, and a firmware rename shows up here as a failing test.

    pip install pyyaml && esphome must be on PATH
    python3 dev/generate-fixtures.py

Needs a checkout of hacf-fr/Solar-Router-for-ESPHome next to this repository,
with its `local_*.yaml` variants present (they are gitignored there; run
`tools/convert_to_local_source.py` to create them) and a `secrets.yaml`.

The fixtures that no root config produces -- an offline device, one still
booting, one on firmware older than the version sensors -- are derived at test
time instead, in `test/fixtures/load.ts`.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
FIRMWARE = Path(
    os.environ.get("SOLAR_ROUTER_FIRMWARE", REPO.parent / "Solar-Router-for-ESPHome")
)
OUT = REPO / "test" / "fixtures"

# ESPHome domain -> Home Assistant domain. A text_sensor becomes a sensor.
DOMAINS = {
    "sensor": "sensor",
    "binary_sensor": "binary_sensor",
    "switch": "switch",
    "number": "number",
    "light": "light",
    "text_sensor": "sensor",
    "button": "button",
    "select": "select",
}

# local config -> fixture name, following plan/PLAN.md section 4.
MAPPING = {
    "esp32-standalone": "engine_1dimmer_fronius",
    "esp32-standalone_1dimmer_2switches": "engine_1dimmer_2switches",
    "esp32-standalone_1dimmer_2switches_1bypass": "engine_1dimmer_2switches_1bypass",
    "esp32-standalone_DS18B20": "engine_1dimmer_ds18b20_counter",
    "esp32-standalone_shedule_forced_run": "engine_1dimmer_scheduler",
    "esp32-em3-router": "engine_1dimmer_em3",
    "esp32-JSY-MK-194T": "engine_1dimmer_jsy_debug",
    "esp8266-proxy-client": "engine_1dimmer_1bypass",
    "esp8266-standalone_on_off": "engine_1switch_ha_limiter",
    "esp8285-power-meter-proxy": "proxy_only",
    "wt32-eth01-solar-water-heater": "engine_1dimmer_fan",
}


class Loose(yaml.SafeLoader):
    """Tolerate !secret and friends: we only care about names and categories."""


def _keep_scalar(loader, suffix, node):
    """Keep the text of a tagged scalar (!lambda holds the version literal)."""
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    return None


Loose.add_multi_constructor("!", _keep_scalar)


def slug(text):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9_]+", "_", text.lower())).strip("_")


def truthy(value):
    return str(value).strip().lower() in {"true", "yes", "on", "1"}


def entities_of(cfg):
    device = slug(cfg["esphome"]["name"])
    out = []
    for esph_domain, ha_domain in DOMAINS.items():
        for item in cfg.get(esph_domain) or []:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            # `internal: true` never reaches Home Assistant.
            if not name or truthy(item.get("internal", False)):
                continue
            category = item.get("entity_category")
            out.append(
                {
                    "entity_id": f"{ha_domain}.{device}_{slug(str(name))}",
                    "domain": ha_domain,
                    "original_name": str(name),
                    "name": None,
                    "entity_category": category if category in ("config", "diagnostic") else None,
                    "disabled_by": None,
                    "hidden_by": None,
                    "state": None,  # filled in below
                    "attributes": {},
                }
            )
    out.sort(key=lambda e: (e["domain"], e["original_name"]))
    return device, out


def version_of(cfg, name):
    """The literal a version text_sensor publishes, read back from the config."""
    for item in cfg.get("text_sensor") or []:
        if isinstance(item, dict) and item.get("name") == name:
            lam = str(item.get("lambda", ""))
            found = re.search(r'return \{"([0-9.]+)"\}', lam)
            if found:
                return found.group(1)
    return None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for local, fixture in MAPPING.items():
        path = FIRMWARE / f"local_{local}.yaml"
        if not path.exists():
            print(f"  SKIP {fixture}: {path.name} absent", file=sys.stderr)
            continue
        proc = subprocess.run(
            ["esphome", "config", path.name],
            cwd=FIRMWARE,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if proc.returncode != 0:
            print(f"  FAIL {fixture}: esphome config exited {proc.returncode}", file=sys.stderr)
            print("        " + proc.stdout.strip().splitlines()[-1][:120], file=sys.stderr)
            continue
        text = proc.stdout
        # Drop the INFO banner lines esphome prints before the document.
        text = "\n".join(l for l in text.splitlines() if not l.startswith("INFO "))
        cfg = yaml.load(text, Loader=Loose)
        device, ents = entities_of(cfg)
        for e in ents:
            v = version_of(cfg, e["original_name"])
            e["state"] = v if v else "unknown"
            if v:
                e["attributes"] = {"icon": "mdi:tag-outline"}
        payload = {
            "device": {
                "id": f"dev_{slug(fixture)}",
                "name": cfg["esphome"]["name"],
                "sw_version": "2026.8.2",
            },
            "entities": ents,
        }
        (OUT / f"{fixture}.json").write_text(json.dumps(payload, indent=2) + "\n")
        versions = sum(1 for e in ents if e["attributes"].get("icon") == "mdi:tag-outline")
        written.append((fixture, len(ents), versions))
        print(f"  {fixture:36s} {len(ents):3d} entites, {versions:2d} versions")
    print(f"\n{len(written)} fixtures ecrites")


if __name__ == "__main__":
    main()
