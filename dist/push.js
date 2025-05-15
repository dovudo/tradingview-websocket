"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setWebSocketServer = setWebSocketServer;
exports.pushBar = pushBar;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
// WebSocket сервер (опционально)
let wsServer = null;
// Установка WebSocket сервера
function setWebSocketServer(server) {
    wsServer = server;
    logger_1.logger.info('WebSocket server set for push service');
}
// Функция для отправки бара в API и WebSocket клиентам
async function pushBar(bar) {
    // Если есть WebSocket сервер, отправляем данные через него
    if (wsServer) {
        wsServer.broadcastBar(bar);
    }
    // Если конфигурация backend отключена, не отправляем по HTTP
    if (!config_1.config.backend.endpoint) {
        return;
    }
    const payload = {
        symbol: bar.symbol,
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        timeframe: bar.timeframe,
    };
    const headers = {
        'Content-Type': 'application/json',
        'X-Api-Key': config_1.config.backend.apiKey,
    };
    let attempt = 0;
    const maxAttempts = 1 + config_1.config.retry?.httpRetry?.attempts || 3;
    const backoffSec = config_1.config.retry?.httpRetry?.backoffSec || 1;
    while (attempt < maxAttempts) {
        const end = metrics_1.httpPushLatency.startTimer();
        try {
            await axios_1.default.post(config_1.config.backend.endpoint, payload, { headers });
            metrics_1.barsPushedTotal.inc();
            logger_1.logger.debug('Pushed bar: %o', payload);
            end();
            return;
        }
        catch (err) {
            end();
            logger_1.logger.error('Failed to push bar (attempt %d): %s', attempt + 1, err.message);
            attempt++;
            if (attempt < maxAttempts)
                await new Promise(res => setTimeout(res, backoffSec * 1000));
        }
    }
    logger_1.logger.error('Giving up on pushing bar after %d attempts', maxAttempts);
}
