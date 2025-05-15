"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
const tradingview_1 = require("./tradingview");
const push_1 = require("./push");
const websocket_1 = require("./websocket");
logger_1.logger.info('tv-fetcher starting...');
logger_1.logger.info('Config: %o', config_1.config);
// Запуск сервера метрик для мониторинга
const metricsPort = config_1.config.metrics.port;
(0, metrics_1.startMetricsServer)(metricsPort);
// Создаем клиент TradingView
let tvClient;
// Создаем WebSocket сервер если он включен
let wsServer = null;
if (config_1.config.websocket.enabled) {
    const wsPort = config_1.config.websocket.port;
    wsServer = new websocket_1.WebSocketServer();
    (0, push_1.setWebSocketServer)(wsServer);
    // Обработка подписок через WebSocket
    wsServer.on('subscribe', async (subscription) => {
        logger_1.logger.info('WebSocket requested subscription: %o', subscription);
        await tvClient.subscribe(subscription);
    });
    wsServer.on('unsubscribe', async ({ symbol, timeframe }) => {
        logger_1.logger.info('WebSocket requested unsubscription: %s/%s', symbol, timeframe);
        await tvClient.unsubscribe(symbol, timeframe);
    });
    logger_1.logger.info('WebSocket server started on port %d', wsPort);
}
// Функция для запуска и подписки на начальные символы
async function start() {
    // Создаем TradingView клиент
    tvClient = new tradingview_1.TradingViewClient();
    // Обработка ошибок
    tvClient.on('error', (err) => {
        logger_1.logger.error('TradingView error: %s', err.message);
    });
    // Обработка отключения
    tvClient.on('disconnect', () => {
        logger_1.logger.warn('TradingView disconnected, reconnecting...');
    });
    // Обработка получения баров
    tvClient.on('bar', async (bar) => {
        try {
            await (0, push_1.pushBar)(bar);
        }
        catch (err) {
            logger_1.logger.error('Push error: %s', err.message);
        }
    });
    // Подключаемся
    await tvClient.connect();
    // Если есть начальные подписки в конфигурации, подписываемся
    if (config_1.config.subscriptions.length > 0) {
        logger_1.logger.info('Subscribing to initial %d pairs from config', config_1.config.subscriptions.length);
        await tvClient.updateSubscriptions(config_1.config.subscriptions);
    }
}
// Старт приложения
start().catch((err) => {
    logger_1.logger.error('Failed to start: %s', err.message);
    process.exit(1);
});
// Обработка сигналов завершения
process.on('SIGINT', () => {
    logger_1.logger.info('SIGINT received, shutting down...');
    if (wsServer)
        wsServer.close();
    if (tvClient)
        tvClient.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger_1.logger.info('SIGTERM received, shutting down...');
    if (wsServer)
        wsServer.close();
    if (tvClient)
        tvClient.close();
    process.exit(0);
});
