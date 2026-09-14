import { NormalizedEnergyData } from './NormalizedEnergyData.js';

export class SimulatorDataAdapter {
    static transform(dayData) {
        if (!dayData || !Array.isArray(dayData.samples)) {
            throw new Error("Structure de données invalide : 'samples' manquant.");
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

            const pSolar = Math.max(0, s.pv_power_w || 0);
            const pConsumption = Math.max(0, s.load_power_w || 0);
            const pGrid = s.grid_power_w || 0;

            const pImport = Math.max(pGrid, 0);
            const pExport = Math.max(-pGrid, 0);
            const pSolarToLoad = Math.min(pSolar, pConsumption);

            // Validation de la cohérence : consumption = solarToLoad + gridImport
            const expectedConsumption = pSolarToLoad + pImport;
            if (Math.abs(pConsumption - expectedConsumption) > 1.0) {
                console.warn(`[Adapter] Incohérence à l'échantillon ${i}: ` +
                    `calculé=${expectedConsumption}W vs brut=${pConsumption}W`);
            }

            timestamps[i] = new Date(s.timestamp).getTime() / 1000;
            solar[i] = pSolar;
            consumption[i] = pConsumption;
            solarToLoad[i] = pSolarToLoad;
            gridImport[i] = pImport;
            gridExport[i] = pExport;
        }

        const metadata = {
            energyPvWh: dayData.energy_pv_wh || 0,
            energyLoadWh: dayData.energy_load_wh || 0,
            autoconsoRatio: dayData.autoconsumption_rate || 0,
            autonomyRatio: dayData.autonomy_rate || 0,
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