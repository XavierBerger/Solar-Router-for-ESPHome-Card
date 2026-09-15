/**
 * Modèle de données normalisé pour la visualisation énergétique.
 * Totalement indépendant de la source de données (Fronius, HA, etc.)
 */
export class NormalizedEnergyData {
    constructor(timestamps, solar, consumption, solarToLoad, gridImport, gridExport, metadata = {}) {
        this.timestamps = timestamps;
        this.solar = solar;
        this.consumption = consumption;
        this.solarToLoad = solarToLoad;
        this.gridImport = gridImport;
        this.gridExport = gridExport;
        this.metadata = metadata;
    }

    toMainChartData() {
        const zero = new Float32Array(this.timestamps.length);

        return [
            this.timestamps,
            zero,
            this.solarToLoad,
            this.consumption,
            this.solar
        ];
    }

    toGridChartData() {
        const len = this.gridImport.length;
        const negativeImport = new Float32Array(len);

        for (let i = 0; i < len; i++) {
            negativeImport[i] = -this.gridImport[i];
        }

        return [
            this.timestamps,
            this.gridExport,
            negativeImport
        ];
    }
}
