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

        const mainData = normalizedData.toMainChartData();
        const gridData = normalizedData.toGridChartData();

        if (!this.mainChart || !this.gridChart) {
            this.buildCharts(mainData, gridData);
        } else {
            this.mainChart.setData(mainData);
            this.gridChart.setData(gridData);
        }
    }

    buildCharts(mainData, gridData) {
        this.mainContainer.innerHTML = '';
        this.gridContainer.innerHTML = '';

        const mainWidth = this.mainContainer.clientWidth || 800;
        const mainHeight = this.mainContainer.clientHeight || 300;
        const gridWidth = this.gridContainer.clientWidth || 800;
        const gridHeight = this.gridContainer.clientHeight || 150;

        const mainOpts = {
            width: mainWidth,
            height: mainHeight,
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
                    label: "Production Solaire (W)",
                    stroke: "#f59e0b",
                    width: 2,
                    fill: "rgba(245, 158, 11, 0.12)"
                },
                {
                    label: "Solaire Direct (W)",
                    stroke: "rgba(16, 185, 129, 0)",
                    width: 0,
                    fill: null
                },
                {
                    label: "Consommation (W)",
                    stroke: "#3b82f6",
                    width: 2,
                    fill: null
                }
            ],
            bands: [
                {
                    series: [1, 2],
                    fill: "rgba(16, 185, 129, 0.35)",
                    dir: -1
                },
                {
                    series: [2, 3],
                    fill: "rgba(239, 68, 68, 0.35)",
                    dir: -1
                }
            ]
        };

        const gridOpts = {
            width: gridWidth,
            height: gridHeight,
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

    resetZoom() {
        if (!this.currentData) return;

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
