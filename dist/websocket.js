"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketServer = exports.MessageType = void 0;
const ws_1 = __importDefault(require("ws"));
const events_1 = require("events");
const config_1 = require("./config");
const logger_1 = require("./logger");
// Типы сообщений WebSocket
var MessageType;
(function (MessageType) {
    MessageType["SUBSCRIBE"] = "subscribe";
    MessageType["UNSUBSCRIBE"] = "unsubscribe";
    MessageType["LIST"] = "list";
    MessageType["BAR"] = "bar";
    MessageType["ERROR"] = "error";
    MessageType["INFO"] = "info";
    MessageType["SUBSCRIBE_MANY"] = "subscribe_many";
    MessageType["UNSUBSCRIBE_MANY"] = "unsubscribe_many";
})(MessageType || (exports.MessageType = MessageType = {}));
class WebSocketServer extends events_1.EventEmitter {
    constructor(server) {
        super();
        this.clients = new Set();
        this.activeSubscriptions = new Map();
        // Новые структуры для учёта подписок по клиентам
        this.clientSubscriptions = new Map();
        this.subscriptionClients = new Map();
        // Создаем WebSocket сервер
        const port = config_1.config.websocket?.port || 8081;
        if (server) {
            // Используем существующий HTTP сервер
            this.wss = new ws_1.default.Server({ server });
            logger_1.logger.info(`WebSocket server attached to existing HTTP server`);
        }
        else {
            // Создаем новый WebSocket сервер
            this.wss = new ws_1.default.Server({ port });
            logger_1.logger.info(`WebSocket server started on port ${port}`);
        }
        // Обработка новых подключений
        this.wss.on('connection', (ws) => {
            this.handleConnection(ws);
        });
        // Обработка ошибок сервера
        this.wss.on('error', (error) => {
            logger_1.logger.error(`WebSocket server error: ${error.message}`);
        });
    }
    // Обработка нового подключения
    handleConnection(ws) {
        logger_1.logger.info('New WebSocket client connected');
        this.clients.add(ws);
        this.clientSubscriptions.set(ws, new Set());
        // Отправляем приветственное сообщение
        this.sendMessage(ws, {
            type: MessageType.INFO,
            success: true,
            message: 'Connected to TradingView WebSocket Server'
        });
        // Обработка сообщений от клиента
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                this.handleMessage(ws, data);
            }
            catch (error) {
                logger_1.logger.error(`Failed to parse WebSocket message: ${error.message}`);
                this.sendMessage(ws, {
                    type: MessageType.ERROR,
                    success: false,
                    message: 'Invalid JSON message'
                });
            }
        });
        // Обработка закрытия соединения
        ws.on('close', () => {
            logger_1.logger.info('WebSocket client disconnected');
            this.clients.delete(ws);
            // Автоматическая отписка от всех тикеров, на которые был подписан этот клиент
            const subs = this.clientSubscriptions.get(ws);
            if (subs) {
                for (const key of subs) {
                    const clients = this.subscriptionClients.get(key);
                    if (clients) {
                        clients.delete(ws);
                        if (clients.size === 0) {
                            this.subscriptionClients.delete(key);
                            const [symbol, timeframe] = key.split('_');
                            this.activeSubscriptions.delete(key);
                            this.emit('unsubscribe', { symbol, timeframe });
                            logger_1.logger.info('Auto-unsubscribed from %s/%s (last client disconnected)', symbol, timeframe);
                        }
                    }
                }
                this.clientSubscriptions.delete(ws);
            }
        });
        // Обработка ошибок
        ws.on('error', (error) => {
            logger_1.logger.error(`WebSocket client error: ${error.message}`);
        });
    }
    // Обработка входящих сообщений
    handleMessage(ws, data) {
        logger_1.logger.info(`Received WebSocket message: ${JSON.stringify(data)}`);
        switch (data.action) {
            case MessageType.SUBSCRIBE:
                this.handleSubscribe(ws, data);
                break;
            case MessageType.UNSUBSCRIBE:
                this.handleUnsubscribe(ws, data);
                break;
            case MessageType.LIST:
                this.handleList(ws, data);
                break;
            case MessageType.SUBSCRIBE_MANY:
                this.handleSubscribeMany(ws, data);
                break;
            case MessageType.UNSUBSCRIBE_MANY:
                this.handleUnsubscribeMany(ws, data);
                break;
            default:
                this.sendMessage(ws, {
                    type: MessageType.ERROR,
                    requestId: data.requestId,
                    success: false,
                    message: `Unknown action: ${data.action}`
                });
        }
    }
    // Обработка запроса на подписку
    handleSubscribe(ws, data) {
        if (!data.symbol || !data.timeframe) {
            return this.sendMessage(ws, {
                type: MessageType.ERROR,
                requestId: data.requestId,
                success: false,
                message: 'Symbol and timeframe are required for subscription'
            });
        }
        const key = `${data.symbol}_${data.timeframe}`;
        // Если уже есть такая подписка для этого клиента — просто подтверждаем
        const clientSubs = this.clientSubscriptions.get(ws) || new Set();
        if (clientSubs.has(key)) {
            return this.sendMessage(ws, {
                type: MessageType.SUBSCRIBE,
                requestId: data.requestId,
                success: true,
                message: 'Already subscribed',
                symbol: data.symbol,
                timeframe: data.timeframe
            });
        }
        // Добавляем подписку для клиента
        clientSubs.add(key);
        this.clientSubscriptions.set(ws, clientSubs);
        // Добавляем клиента в список слушателей тикера
        let clients = this.subscriptionClients.get(key);
        let isFirst = false;
        if (!clients) {
            clients = new Set();
            this.subscriptionClients.set(key, clients);
            isFirst = true;
        }
        clients.add(ws);
        // Если это первая подписка на тикер — создаём TradingView подписку
        if (isFirst) {
            const subscription = { symbol: data.symbol, timeframe: data.timeframe };
            this.activeSubscriptions.set(key, subscription);
            this.emit('subscribe', subscription);
            logger_1.logger.info('First client subscribed to %s/%s, subscribing to TradingView', data.symbol, data.timeframe);
        }
        // Подтверждение клиенту
        this.sendMessage(ws, {
            type: MessageType.SUBSCRIBE,
            requestId: data.requestId,
            success: true,
            message: isFirst ? 'Subscription created' : 'Subscribed (shared)',
            symbol: data.symbol,
            timeframe: data.timeframe
        });
    }
    // Обработка запроса на отписку
    handleUnsubscribe(ws, data) {
        if (!data.symbol || !data.timeframe) {
            return this.sendMessage(ws, {
                type: MessageType.ERROR,
                requestId: data.requestId,
                success: false,
                message: 'Symbol and timeframe are required for unsubscription'
            });
        }
        const key = `${data.symbol}_${data.timeframe}`;
        const clientSubs = this.clientSubscriptions.get(ws);
        if (!clientSubs || !clientSubs.has(key)) {
            return this.sendMessage(ws, {
                type: MessageType.UNSUBSCRIBE,
                requestId: data.requestId,
                success: false,
                message: 'Subscription not found for this client',
                symbol: data.symbol,
                timeframe: data.timeframe
            });
        }
        clientSubs.delete(key);
        // Удаляем клиента из списка слушателей тикера
        const clients = this.subscriptionClients.get(key);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                this.subscriptionClients.delete(key);
                this.activeSubscriptions.delete(key);
                this.emit('unsubscribe', { symbol: data.symbol, timeframe: data.timeframe });
                logger_1.logger.info('Last client unsubscribed from %s/%s, unsubscribing from TradingView', data.symbol, data.timeframe);
            }
        }
        // Подтверждение клиенту
        this.sendMessage(ws, {
            type: MessageType.UNSUBSCRIBE,
            requestId: data.requestId,
            success: true,
            message: 'Unsubscribed successfully',
            symbol: data.symbol,
            timeframe: data.timeframe
        });
    }
    // Обработка запроса на получение списка подписок
    handleList(ws, data) {
        const subscriptions = Array.from(this.activeSubscriptions.values());
        this.sendMessage(ws, {
            type: MessageType.LIST,
            requestId: data.requestId,
            success: true,
            subscriptions
        });
    }
    // Массовая подписка
    handleSubscribeMany(ws, data) {
        if (!Array.isArray(data.pairs) || data.pairs.length === 0) {
            return this.sendMessage(ws, {
                type: MessageType.ERROR,
                requestId: data.requestId,
                success: false,
                message: 'pairs[] required for subscribe_many'
            });
        }
        const results = data.pairs.map(pair => {
            if (!pair.symbol || !pair.timeframe) {
                return { ...pair, success: false, message: 'symbol and timeframe required' };
            }
            const key = `${pair.symbol}_${pair.timeframe}`;
            if (this.activeSubscriptions.has(key)) {
                return { ...pair, success: true, message: 'Already subscribed' };
            }
            const subscription = { symbol: pair.symbol, timeframe: pair.timeframe };
            this.activeSubscriptions.set(key, subscription);
            this.emit('subscribe', subscription);
            return { ...pair, success: true, message: 'Subscription created' };
        });
        this.sendMessage(ws, {
            type: MessageType.SUBSCRIBE_MANY,
            requestId: data.requestId,
            success: true,
            message: 'Bulk subscribe processed',
            subscriptions: this.getActiveSubscriptions(),
            results
        });
    }
    // Массовая отписка
    handleUnsubscribeMany(ws, data) {
        if (!Array.isArray(data.pairs) || data.pairs.length === 0) {
            return this.sendMessage(ws, {
                type: MessageType.ERROR,
                requestId: data.requestId,
                success: false,
                message: 'pairs[] required for unsubscribe_many'
            });
        }
        const results = data.pairs.map(pair => {
            if (!pair.symbol || !pair.timeframe) {
                return { ...pair, success: false, message: 'symbol and timeframe required' };
            }
            const key = `${pair.symbol}_${pair.timeframe}`;
            if (!this.activeSubscriptions.has(key)) {
                return { ...pair, success: false, message: 'Subscription not found' };
            }
            this.activeSubscriptions.delete(key);
            this.emit('unsubscribe', { symbol: pair.symbol, timeframe: pair.timeframe });
            return { ...pair, success: true, message: 'Unsubscribed successfully' };
        });
        this.sendMessage(ws, {
            type: MessageType.UNSUBSCRIBE_MANY,
            requestId: data.requestId,
            success: true,
            message: 'Bulk unsubscribe processed',
            subscriptions: this.getActiveSubscriptions(),
            results
        });
    }
    // Отправка сообщения клиенту
    sendMessage(ws, data) {
        if (ws.readyState === ws_1.default.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }
    // Отправка бара всем подключенным клиентам
    broadcastBar(bar) {
        const message = {
            type: MessageType.BAR,
            bar
        };
        this.clients.forEach((client) => {
            if (client.readyState === ws_1.default.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
    // Получение списка активных подписок
    getActiveSubscriptions() {
        return Array.from(this.activeSubscriptions.values());
    }
    // Проверка, есть ли подписка
    hasSubscription(symbol, timeframe) {
        return this.activeSubscriptions.has(`${symbol}_${timeframe}`);
    }
    // Добавление подписки программно (без запроса от клиента)
    addSubscription(subscription) {
        const key = `${subscription.symbol}_${subscription.timeframe}`;
        if (!this.activeSubscriptions.has(key)) {
            this.activeSubscriptions.set(key, subscription);
            this.emit('subscribe', subscription);
            return true;
        }
        return false;
    }
    // Удаление подписки программно (без запроса от клиента)
    removeSubscription(symbol, timeframe) {
        const key = `${symbol}_${timeframe}`;
        if (this.activeSubscriptions.has(key)) {
            this.activeSubscriptions.delete(key);
            this.emit('unsubscribe', { symbol, timeframe });
            return true;
        }
        return false;
    }
    // Закрытие всех соединений и остановка сервера
    close() {
        this.wss.close(() => {
            logger_1.logger.info('WebSocket server closed');
        });
    }
}
exports.WebSocketServer = WebSocketServer;
