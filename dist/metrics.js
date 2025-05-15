"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionsGauge = exports.httpPushLatency = exports.barsPushedTotal = exports.wsErrorsTotal = exports.wsConnectsTotal = void 0;
exports.startMetricsServer = startMetricsServer;
const prom_client_1 = __importDefault(require("prom-client"));
const logger_1 = require("./logger");
const express_1 = __importDefault(require("express"));
exports.wsConnectsTotal = new prom_client_1.default.Counter({
    name: 'tv_ws_connects_total',
    help: 'Total WebSocket connections',
});
exports.wsErrorsTotal = new prom_client_1.default.Counter({
    name: 'tv_ws_errors_total',
    help: 'Total WebSocket connection errors',
});
exports.barsPushedTotal = new prom_client_1.default.Counter({
    name: 'tv_bars_pushed_total',
    help: 'Total bars pushed to backend',
});
exports.httpPushLatency = new prom_client_1.default.Histogram({
    name: 'tv_http_push_latency_seconds',
    help: 'HTTP push latency in seconds',
    buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});
exports.subscriptionsGauge = new prom_client_1.default.Gauge({
    name: 'tv_active_subscriptions',
    help: 'Current number of active subscriptions',
});
function startMetricsServer(port) {
    const app = (0, express_1.default)();
    app.get('/metrics', async (_req, res) => {
        res.set('Content-Type', prom_client_1.default.register.contentType);
        res.end(await prom_client_1.default.register.metrics());
    });
    app.listen(port, () => {
        logger_1.logger.info(`Prometheus metrics server started on :${port}`);
    });
}
