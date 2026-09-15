import { EnergyChartRenderer } from './EnergyChartRenderer.js';
import { SimulatorDataAdapter } from './SimulatorDataAdapter.js';

class ViewerApp {
    constructor() {
        this.mainContainer = document.getElementById('main-chart');
        this.gridContainer = document.getElementById('grid-chart');
        this.statusEl = document.getElementById('status-indicator');
        this.metaEl = document.getElementById('meta-info');
        this.errorBanner = document.getElementById('error-banner');
        this.errorMessage = document.getElementById('error-message');
        this.retryBtn = document.getElementById('retry-btn');
        this.resetZoomBtn = document.getElementById('reset-zoom-btn');

        this.renderer = new EnergyChartRenderer(this.mainContainer, this.gridContainer);

        this.initEvents();
    }

    initEvents() {
        this.retryBtn.addEventListener('click', () => this.loadData());
        this.resetZoomBtn.addEventListener('click', () => this.renderer.resetZoom());
    }

    async loadData() {
        this.updateStatus('loading', 'Chargement en cours...');
        this.hideError();

        try {
            const response = await fetch('/simulation/day');
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status} ${response.statusText}`);
            }

            const rawJson = await response.json();
            const normalizedData = SimulatorDataAdapter.transform(rawJson);

            this.renderer.render(normalizedData);
            this.updateKPIs(normalizedData.metadata);
            this.updateStatus('success', 'Connecté');
            this.metaEl.textContent = `${normalizedData.metadata.sampleCount} points (1 mn intervalle)`;
        } catch (err) {
            console.error('[ViewerApp] Échec :', err);
            this.updateStatus('error', 'Erreur de chargement');
            this.showError(`Impossible de charger /simulation/day : ${err.message}`);
        }
    }

    updateStatus(type, text) {
        this.statusEl.className = `status-badge ${type}`;
        this.statusEl.textContent = text;
    }

    showError(msg) {
        this.errorMessage.textContent = msg;
        this.errorBanner.classList.remove('hidden');
    }

    hideError() {
        this.errorBanner.classList.add('hidden');
    }

    updateKPIs(meta) {
        document.getElementById('kpi-pv').textContent = `${(meta.pvEnergyWh / 1000).toFixed(2)} kWh`;
        document.getElementById('kpi-load').textContent = `${(meta.loadEnergyWh / 1000).toFixed(2)} kWh`;
        document.getElementById('kpi-autocons').textContent = `${(meta.selfConsumptionRatio * 100).toFixed(1)} %`;
        document.getElementById('kpi-autonomy').textContent = `${(meta.autonomyRatio * 100).toFixed(1)} %`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new ViewerApp();
    app.loadData();
});
