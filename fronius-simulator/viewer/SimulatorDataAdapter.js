import { NormalizedEnergyData } from './NormalizedEnergyData.js';

const DAY_START_UNIX_SECONDS = Date.UTC(2024, 0, 1) / 1000;

export class SimulatorDataAdapter {
    static transform(dayData) {
        if (!dayData || !Array.isArray(dayData.samples)) {
            throw new Error("Structure de données invalide : 'samples' manquant.");
        }

        if (!dayData.summary) {
            throw new Error("Structure de données invalide : 'summary' manquant.");
        }

        const samples = dayData.samples;
        const len = samples.length;

        const timestamps = new Float64Array(len);
        const solar = new Float32Array(len);
        const consumption = new Float32Array(len);
        const solarToLoad = new Float32Array(len);
        const gridImport = new Float32Array(len);
        const gridExport = new Float32Array(len);

        for (let i = 0; i < len; i++) {
            const s = samples[i];

            if (!Number.isFinite(s.sim_time_seconds)) {
                throw new Error(`Échantillon ${i} invalide : 'sim_time_seconds' manquant.`);
            }

            const pSolar = Math.max(0, Number(s.pv_power_w) || 0);
            const pConsumption = Math.max(0, Number(s.load_power_w) || 0);
            const pGrid = Number(s.grid_power_w) || 0;

            const pImport = Math.max(pGrid, 0);
            const pExport = Math.max(-pGrid, 0);
            const pSolarToLoad = Math.min(pSolar, pConsumption);

            // Les timestamps sont artificiels : seul l'ordre et l'heure simulée
            // comptent pour la visualisation d'une journée complète.
            timestamps[i] = DAY_START_UNIX_SECONDS + s.sim_time_seconds;
            solar[i] = pSolar;
            consumption[i] = pConsumption;
            solarToLoad[i] = pSolarToLoad;
            gridImport[i] = pImport;
            gridExport[i] = pExport;

            // Invariant énergétique : consumption = solarToLoad + gridImport.
            const expectedConsumption = pSolarToLoad + pImport;
            if (Math.abs(pConsumption - expectedConsumption) > 1.0) {
                console.warn(
                    `[Adapter] Incohérence à l'échantillon ${i}: ` +
                    `calculé=${expectedConsumption}W vs brut=${pConsumption}W`
                );
            }
        }

        const summary = dayData.summary;
        const pvEnergyWh = Math.max(0, Number(summary.pv_energy_wh) || 0);
        const loadEnergyWh = Math.max(0, Number(summary.load_energy_wh) || 0);
        const gridImportWh = Math.max(0, Number(summary.grid_import_wh) || 0);
        const gridExportWh = Math.max(0, Number(summary.grid_export_wh) || 0);
        const selfConsumedEnergyWh = Math.max(0, pvEnergyWh - gridExportWh);

        const metadata = {
            pvEnergyWh,
            loadEnergyWh,
            gridImportWh,
            gridExportWh,
            selfConsumptionRatio: pvEnergyWh > 0
                ? selfConsumedEnergyWh / pvEnergyWh
                : 0,
            autonomyRatio: loadEnergyWh > 0
                ? selfConsumedEnergyWh / loadEnergyWh
                : 0,
            sampleCount: len
        };

        return new NormalizedEnergyData(
            timestamps,
            solar,
            consumption,
            solarToLoad,
            gridImport,
            gridExport,
            metadata
        );
    }
}
