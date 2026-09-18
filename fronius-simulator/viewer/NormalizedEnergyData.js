/**
 * Modèle de données normalisé pour la visualisation énergétique.
 * Indépendant de la source (Fronius, HA, etc.) et du moteur graphique :
 * la mise en forme uPlot appartient au renderer.
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
}
