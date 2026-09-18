// Lancer depuis fronius-simulator/ :  node --test 'viewer-tests/*.test.js'
//
// Runner integre de Node (>= 18), sans package.json ni dependance : aucune
// installation npm ne doit etre necessaire pour lancer ces tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SimulatorDataAdapter } from '../viewer/SimulatorDataAdapter.js';

const DAY_START = Date.UTC(2024, 0, 1) / 1000;

function sample(simTimeSeconds, pvPowerW, loadPowerW) {
    return {
        time: '00:00:00',
        sim_time_seconds: simTimeSeconds,
        pv_power_w: pvPowerW,
        load_power_w: loadPowerW,
        grid_power_w: loadPowerW - pvPowerW
    };
}

function dayData(samples, summary = {}) {
    return {
        step_seconds: 10,
        sample_count: samples.length,
        duration_seconds: 86_400,
        summary: {
            pv_energy_wh: 0,
            load_energy_wh: 0,
            grid_import_wh: 0,
            grid_export_wh: 0,
            ...summary
        },
        samples
    };
}

// Valeurs calculees a la main, pas re-derivees des formules testees : une
// inversion de min/max ou de signe dans l'adaptateur fait tomber ce test.
const CASES = [
    { name: 'nuit, aucune production', pv: 0, load: 400, solarToLoad: 0, gridImport: 400, gridExport: 0 },
    { name: 'surplus injecte', pv: 1000, load: 400, solarToLoad: 400, gridImport: 0, gridExport: 600 },
    { name: 'appoint reseau', pv: 300, load: 900, solarToLoad: 300, gridImport: 600, gridExport: 0 },
    { name: 'equilibre exact', pv: 500, load: 500, solarToLoad: 500, gridImport: 0, gridExport: 0 }
];

test('derive les cinq series a partir de la puissance reseau', () => {
    const data = SimulatorDataAdapter.transform(
        dayData(CASES.map((c, i) => sample(i * 10, c.pv, c.load)))
    );

    CASES.forEach((c, i) => {
        assert.equal(data.solar[i], c.pv, `${c.name} : solar`);
        assert.equal(data.consumption[i], c.load, `${c.name} : consumption`);
        assert.equal(data.solarToLoad[i], c.solarToLoad, `${c.name} : solarToLoad`);
        assert.equal(data.gridImport[i], c.gridImport, `${c.name} : gridImport`);
        assert.equal(data.gridExport[i], c.gridExport, `${c.name} : gridExport`);
    });
});

// L'invariant est aujourd'hui garanti par construction (l'adaptateur derive les
// deux membres des memes entrees). Le test le fige comme contrat : le jour ou
// gridImport viendra directement du serveur, il devra continuer a tenir.
test('respecte l invariant consumption = solarToLoad + gridImport', () => {
    const data = SimulatorDataAdapter.transform(
        dayData(CASES.map((c, i) => sample(i * 10, c.pv, c.load)))
    );

    CASES.forEach((c, i) => {
        assert.equal(
            data.consumption[i],
            data.solarToLoad[i] + data.gridImport[i],
            `${c.name} : invariant rompu`
        );
    });
});

test('derive les ratios energetiques du resume', () => {
    const data = SimulatorDataAdapter.transform(
        dayData([sample(0, 0, 400)], {
            pv_energy_wh: 10_000,
            load_energy_wh: 8_000,
            grid_import_wh: 3_000,
            grid_export_wh: 5_000
        })
    );

    // Autoconsomme = pv - export = 5000 Wh.
    assert.equal(data.metadata.selfConsumptionRatio, 0.5);
    assert.equal(data.metadata.autonomyRatio, 0.625);
    assert.equal(data.metadata.stepSeconds, 10);
    assert.equal(data.metadata.sampleCount, 1);
});

test('renvoie des ratios nuls plutot que NaN sur une journee vide', () => {
    const data = SimulatorDataAdapter.transform(dayData([sample(0, 0, 0)]));

    assert.equal(data.metadata.selfConsumptionRatio, 0);
    assert.equal(data.metadata.autonomyRatio, 0);
});

test('ancre les timestamps sur minuit UTC en preservant l ordre', () => {
    const data = SimulatorDataAdapter.transform(
        dayData([sample(0, 0, 400), sample(10, 0, 400), sample(45_000, 0, 400)])
    );

    assert.equal(data.timestamps[0], DAY_START);
    assert.equal(data.timestamps[2], DAY_START + 45_000);
    assert.ok(data.timestamps[1] > data.timestamps[0]);
    // 45 000 s apres minuit UTC = 12:30 UTC, l'heure simulee de l'echantillon.
    assert.equal(new Date(data.timestamps[2] * 1000).getUTCHours(), 12);
});

test('ramene a zero les puissances negatives renvoyees par le serveur', () => {
    const data = SimulatorDataAdapter.transform(
        dayData([{ sim_time_seconds: 0, pv_power_w: -50, load_power_w: -10, grid_power_w: 0 }])
    );

    assert.equal(data.solar[0], 0);
    assert.equal(data.consumption[0], 0);
});

test('rejette un payload malforme au lieu de produire une courbe vide', () => {
    assert.throws(() => SimulatorDataAdapter.transform(null), /samples/);
    assert.throws(() => SimulatorDataAdapter.transform({}), /samples/);
    assert.throws(() => SimulatorDataAdapter.transform({ samples: [] }), /summary/);
    assert.throws(
        () => SimulatorDataAdapter.transform(dayData([{ pv_power_w: 0, load_power_w: 0 }])),
        /sim_time_seconds/
    );
});
