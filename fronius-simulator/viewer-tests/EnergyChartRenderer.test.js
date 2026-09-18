// Lancer depuis fronius-simulator/ :  node --test 'viewer-tests/*.test.js'
//
// Seules les fonctions de mise en forme sont testees : elles sont statiques et
// pures. Le reste du renderer exige un DOM et un canvas, hors perimetre.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EnergyChartRenderer } from '../viewer/EnergyChartRenderer.js';
import { NormalizedEnergyData } from '../viewer/NormalizedEnergyData.js';

function data() {
    return new NormalizedEnergyData(
        Float64Array.from([1_000, 1_010, 1_020]),
        Float32Array.from([0, 1_000, 300]),
        Float32Array.from([400, 400, 900]),
        Float32Array.from([0, 400, 300]),
        Float32Array.from([400, 0, 600]),
        Float32Array.from([0, 600, 0])
    );
}

test('buildMainChartData expose huit series et les bornes des deux bandes', () => {
    const d = data();
    const series = EnergyChartRenderer.buildMainChartData(d);

    assert.equal(series.length, 8, 'une entree par serie declaree dans opts.series');
    assert.equal(series[0], d.timestamps);
    assert.equal(series[1], d.solar);
    assert.deepEqual(Array.from(series[2]), [0, 0, 0], 'borne basse de la bande solaire');
    assert.equal(series[3], d.solarToLoad);
    assert.deepEqual(
        Array.from(series[4]),
        Array.from(d.solarToLoad),
        'borne basse de la bande reseau'
    );
    assert.equal(series[5], d.consumption);
    // Redessinees en 6 et 7 pour passer devant les aplats (ordre de dessin uPlot).
    assert.equal(series[6], d.solar);
    assert.equal(series[7], d.consumption);
});

test('buildGridChartData negativise l import et conserve l export', () => {
    const [timestamps, exported, imported] = EnergyChartRenderer.buildGridChartData(data());

    assert.deepEqual(Array.from(timestamps), [1_000, 1_010, 1_020]);
    assert.deepEqual(Array.from(exported), [0, 600, 0]);
    assert.deepEqual(Array.from(imported), [-400, -0, -600]);
});

test('buildGridChartData ne modifie pas les series d origine', () => {
    const d = data();
    EnergyChartRenderer.buildGridChartData(d);

    assert.deepEqual(Array.from(d.gridImport), [400, 0, 600]);
});
