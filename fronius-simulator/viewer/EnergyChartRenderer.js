// Les timestamps sont ancres sur un minuit UTC (cf. SimulatorDataAdapter).
// Sans cela uPlot les etiquetterait dans le fuseau du navigateur et decalerait
// la journee entiere : l'ancre etant un 1er janvier, Europe/Paris decale de
// +1 h en toute saison, et 23:00 repasse a 0 h en debut de graphique.
const toUtcDate = (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC");

export class EnergyChartRenderer {
    constructor(mainContainerEl, gridContainerEl) {
        this.mainContainer = mainContainerEl;
        this.gridContainer = gridContainerEl;

        this.syncGroup = uPlot.sync("solar-router-sync");

        this.mainChart = null;
        this.gridChart = null;
        this.currentData = null;

        this.resizeObserver = new ResizeObserver(() => this.handleResize());
        this.resizeObserver.observe(this.mainContainer);
        this.resizeObserver.observe(this.gridContainer);
    }

    render(normalizedData) {
        this.currentData = normalizedData;

        const mainData = EnergyChartRenderer.buildMainChartData(normalizedData);
        const gridData = EnergyChartRenderer.buildGridChartData(normalizedData);

        if (!this.mainChart || !this.gridChart) {
            this.buildCharts(mainData, gridData);
        } else {
            this.mainChart.setData(mainData);
            this.gridChart.setData(gridData);
        }
    }

    // Huit series pour quatre tableaux. uPlot dessine un `band` entre deux series
    // existantes, il faut donc materialiser chaque borne : [3,2] peint le solaire
    // direct entre solarToLoad et un zero, [5,4] peint l'import entre la
    // consommation et ce meme solarToLoad. D'ou zero, et les doublons de
    // solarToLoad, solar et consumption.
    //
    // solar et consumption reparaissent en 6 et 7 parce que uPlot dessine dans
    // l'ordre des index : leurs courbes doivent passer *devant* les aplats.
    // Fusionner 1 et 6 les ferait repasser derriere.
    static buildMainChartData(normalizedData) {
        const len = normalizedData.timestamps.length;
        const zero = new Float32Array(len);
        const solarToLoadDuplicate = normalizedData.solarToLoad.slice();

        return [
            normalizedData.timestamps,
            normalizedData.solar,
            zero,
            normalizedData.solarToLoad,
            solarToLoadDuplicate,
            normalizedData.consumption,
            normalizedData.solar,
            normalizedData.consumption
        ];
    }

    // L'import est trace vers le bas, l'export vers le haut, de part et d'autre
    // du zero materialise par drawZeroLine.
    static buildGridChartData(normalizedData) {
        const len = normalizedData.gridImport.length;
        const negativeImport = new Float32Array(len);

        for (let i = 0; i < len; i++) {
            negativeImport[i] = -normalizedData.gridImport[i];
        }

        return [
            normalizedData.timestamps,
            normalizedData.gridExport,
            negativeImport
        ];
    }

    buildCharts(mainData, gridData) {
        // Un build interrompu laisse un graphe derriere lui : vider innerHTML
        // orpheline alors son instance uPlot, ses ecouteurs et son abonnement a
        // la synchronisation. Le bouton Reessayer rend ce chemin atteignable.
        this.destroyCharts();

        this.mainContainer.innerHTML = '';
        this.gridContainer.innerHTML = '';

        const mainWidth = this.mainContainer.clientWidth || 800;
        const mainHeight = this.mainContainer.clientHeight || 300;
        const gridWidth = this.gridContainer.clientWidth || 800;
        const gridHeight = this.gridContainer.clientHeight || 150;

        const mainOpts = {
            width: mainWidth,
            height: mainHeight,
            tzDate: toUtcDate,
            cursor: {
                sync: { key: this.syncGroup.key },
                drag: { x: true, y: false }
            },
            scales: {
                x: { time: true },
                y: { auto: true, autoMin: 0 }
            },
            axes: [
                {
                    stroke: "#94a3b8",
                    grid: { stroke: "#334155", width: 1 }
                },
                {
                    stroke: "#94a3b8",
                    grid: { stroke: "#334155", width: 1 },
                    label: "Watts (W)"
                }
            ],
            series: [
                {},
                {
                    label: "Production Solaire",
                    stroke: "rgba(0, 0, 0, 0)",
                    width: 0,
                    fill: "rgba(245, 158, 11, 0.12)"
                },
                {
                    label: "",
                    stroke: "rgba(0, 0, 0, 0)",
                    width: 0,
                    band: true
                },
                {
                    label: "Solaire Direct (W)",
                    width: 0,
                    band: true
                },
                {
                    label: "",
                    stroke: "rgba(0, 0, 0, 0)",
                    width: 0,
                    band: true
                },
                {
                    label: "Consommation Réseau (W)",
                    width: 0,
                    band: true
                },
                {
                    label: "Production Solaire (W)",
                    stroke: "#d4ac1f",
                    width: 1
                },
                {
                    label: "Consommation (W)",
                    stroke: "#3b82f6",
                    width: 1
                }
            ],
            bands: [
                {
                    series: [3, 2],
                    fill: "#a2d49b"
                },
                {
                    series: [5, 4],
                    fill: "#e96e7d"
                }
            ]
        };

        const gridOpts = {
            width: gridWidth,
            height: gridHeight,
            tzDate: toUtcDate,
            cursor: {
                sync: { key: this.syncGroup.key },
                drag: { x: true, y: false }
            },
            scales: {
                x: { time: true },
                y: { auto: true }
            },
            axes: [
                {
                    stroke: "#94a3b8",
                    grid: { stroke: "#334155", width: 1 }
                },
                {
                    stroke: "#94a3b8",
                    grid: { stroke: "#334155", width: 1 },
                    label: "Watts (W)"
                }
            ],
            series: [
                {},
                {
                    label: "Export Réseau (+W)",
                    stroke: "#f59e0b",
                    width: 1.5,
                    fill: "rgba(245, 158, 11, 0.35)"
                },
                {
                    label: "Import Réseau (-W)",
                    stroke: "#ef4444",
                    width: 1.5,
                    fill: "rgba(239, 68, 68, 0.35)"
                }
            ],
            hooks: {
                draw: [this.drawZeroLine]
            }
        };

        this.mainChart = new uPlot(mainOpts, mainData, this.mainContainer);
        this.gridChart = new uPlot(gridOpts, gridData, this.gridContainer);
    }

    drawZeroLine = (chart) => {
        const yScale = chart.scales.y;
        if (yScale.min > 0 || yScale.max < 0) {
            return;
        }

        const y = chart.valToPos(0, "y", true);
        const { ctx, bbox } = chart;

        ctx.save();
        ctx.strokeStyle = "#64748b";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bbox.left, Math.round(y) + 0.5);
        ctx.lineTo(bbox.left + bbox.width, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.restore();
    };

    destroyCharts() {
        this.mainChart?.destroy();
        this.gridChart?.destroy();
        this.mainChart = null;
        this.gridChart = null;
    }

    resetZoom() {
        // currentData est pose avant buildCharts : le tester seul ne garantit
        // pas que les graphes existent.
        if (!this.currentData || !this.mainChart || !this.gridChart) {
            return;
        }

        const ts = this.currentData.timestamps;
        const min = ts[0];
        const max = ts[ts.length - 1];

        this.mainChart.setScale("x", { min, max });
        this.gridChart.setScale("x", { min, max });
    }

    handleResize() {
        if (this.mainChart) {
            this.mainChart.setSize({
                width: this.mainContainer.clientWidth,
                height: this.mainContainer.clientHeight
            });
        }
        if (this.gridChart) {
            this.gridChart.setSize({
                width: this.gridContainer.clientWidth,
                height: this.gridContainer.clientHeight
            });
        }
    }
}
