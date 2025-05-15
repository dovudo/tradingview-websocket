"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradingViewClient = void 0;
const events_1 = require("events");
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
// Импорт библиотеки TradingView из нашей локальной копии
// eslint-disable-next-line @typescript-eslint/no-var-requires
let TV;
try {
    TV = require('../tradingview_vendor/client');
    logger_1.logger.info('TradingView loaded: %o', {
        type: typeof TV,
        isFunction: typeof TV === 'function',
        hasConstructor: TV && typeof TV.constructor === 'function',
        keys: TV ? Object.keys(TV) : []
    });
}
catch (err) {
    logger_1.logger.error('Error loading TradingView: %s', err.message);
    // Создаем заглушку для тестирования
    TV = {
        Client: function () {
            this.loginGuest = async () => Promise.resolve(true);
            this.Chart = function (symbol, options) {
                return {
                    symbol,
                    options,
                    periods: [
                        {
                            time: Date.now() / 1000,
                            open: 100,
                            high: 105,
                            low: 95,
                            close: 101,
                            volume: 100
                        }
                    ],
                    onUpdate: (cb) => setTimeout(cb, 1000),
                    setMarket: () => { },
                    delete: () => { }
                };
            };
        }
    };
}
class TradingViewClient extends events_1.EventEmitter {
    constructor() {
        super();
        this.connected = false;
        this.charts = new Map(); // Отслеживаем подписки для каждого символа
        this.mockIntervalId = null;
        this.reconnectTimeout = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000; // 5 секунд базовая задержка
    }
    async connect() {
        try {
            logger_1.logger.info('Creating TradingView client...');
            if (typeof TV.Client !== 'function') {
                logger_1.logger.error('No TradingView.Client constructor, using mock');
                this.useMockClient();
            }
            else {
                // Используем TV.Client 
                try {
                    this.client = new TV.Client();
                    logger_1.logger.info('TradingView client created successfully');
                }
                catch (err) {
                    logger_1.logger.error('Error creating TradingView client: %s', err.message);
                    this.useMockClient();
                }
            }
            if (!this.client) {
                throw new Error('Could not initialize TradingView client');
            }
            this.connected = true;
            this.reconnectAttempts = 0;
            metrics_1.wsConnectsTotal.inc();
            this.emit('connect');
        }
        catch (err) {
            logger_1.logger.error('Failed to connect TradingView WS: %s', err.message);
            metrics_1.wsErrorsTotal.inc();
            this.emit('error', err);
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
        // Предотвращаем множественные попытки переподключения
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        this.reconnectAttempts++;
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
            logger_1.logger.error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
            this.emit('max_reconnect_attempts');
            return;
        }
        // Экспоненциальная задержка с джиттером для предотвращения thundering herd 
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1) * (1 + Math.random() * 0.2), 60000 // максимум 1 минута
        );
        logger_1.logger.info(`Scheduling reconnect in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.reconnectTimeout = setTimeout(() => {
            logger_1.logger.info('Reconnecting TradingView...');
            this.connect().catch(err => {
                logger_1.logger.error('Reconnect failed:', err);
                this.scheduleReconnect();
            });
        }, delay);
    }
    // Мок-клиент для тестирования
    useMockClient() {
        logger_1.logger.warn('Using mock TradingView client');
        this.client = {
            Session: {
                Chart: function () {
                    return {
                        infos: {
                            description: "Mock Market",
                            currency_id: "USD"
                        },
                        periods: [],
                        onError: function () { },
                        onSymbolLoaded: function (cb) { setTimeout(cb, 100); },
                        onUpdate: function (cb) {
                            // Вызываем callback сразу и затем периодически
                            setTimeout(cb, 500);
                            // Генерируем случайные данные периодически
                            return setInterval(() => {
                                const lastPrice = 100 + Math.random() * 50;
                                this.periods.unshift({
                                    time: Math.floor(Date.now() / 1000),
                                    open: lastPrice - 5,
                                    close: lastPrice,
                                    max: lastPrice + 5,
                                    min: lastPrice - 10,
                                    volume: Math.floor(Math.random() * 1000)
                                });
                                // Ограничиваем размер массива
                                if (this.periods.length > 100) {
                                    this.periods.pop();
                                }
                                cb();
                            }, 1000);
                        },
                        setMarket: function (symbol, options) {
                            this.infos.description = symbol;
                            this.infos.currency_id = "USD";
                            return true;
                        },
                        delete: function () { }
                    };
                }
            },
            end: function () { }
        };
    }
    // Подписка на символ/таймфрейм
    async subscribe(subscription) {
        if (!this.connected || !this.client) {
            logger_1.logger.error('Cannot subscribe, client not connected');
            throw new Error('TradingView client not connected');
        }
        const { symbol, timeframe } = subscription;
        const key = `${symbol}_${timeframe}`;
        // Если уже есть такая подписка - ничего не делаем
        if (this.charts.has(key)) {
            logger_1.logger.info('Already subscribed to %s/%s', symbol, timeframe);
            return true;
        }
        try {
            logger_1.logger.info('Creating chart for %s/%s', symbol, timeframe);
            // Проверяем API
            if (!this.client.Session || typeof this.client.Session.Chart !== 'function') {
                logger_1.logger.error('No Chart constructor in TradingView client, using mock');
                this.useMockClient();
                if (!this.client.Session || typeof this.client.Session.Chart !== 'function') {
                    logger_1.logger.error('Failed to initialize mock Chart');
                    return false;
                }
            }
            // Создаем отдельный chart для символа/таймфрейма
            const chart = new this.client.Session.Chart();
            // Обработка ошибок
            chart.onError((...err) => {
                logger_1.logger.error('Chart error for %s/%s: %o', symbol, timeframe, err);
                this.emit('chart_error', { symbol, timeframe, error: err });
            });
            // Когда символ загружен
            chart.onSymbolLoaded(() => {
                logger_1.logger.info('Symbol loaded for %s/%s: %s', symbol, timeframe, chart.infos?.description || 'Unknown');
                this.emit('symbol_loaded', { symbol, timeframe, description: chart.infos?.description });
            });
            // Обработка обновлений данных
            const updateHandler = chart.onUpdate(() => {
                if (!chart.periods || !chart.periods[0])
                    return;
                // Получаем последний бар
                const lastBar = chart.periods[0];
                if (lastBar) {
                    // Формируем бар для отправки
                    const bar = {
                        symbol,
                        timeframe,
                        time: lastBar.time,
                        open: lastBar.open,
                        high: lastBar.max,
                        low: lastBar.min,
                        close: lastBar.close,
                        volume: lastBar.volume || 0,
                    };
                    logger_1.logger.info('Got bar: %o', bar);
                    // Отправляем бар слушателям
                    this.emit('bar', bar);
                }
            });
            // Сохраняем intervalId для мок-клиента, если он вернулся
            if (typeof updateHandler === 'number') {
                this.mockIntervalId = updateHandler;
            }
            // Устанавливаем рынок
            chart.setMarket(symbol, {
                timeframe
            });
            // Сохраняем chart для этой подписки
            this.charts.set(key, chart);
            metrics_1.subscriptionsGauge.set(this.charts.size);
            logger_1.logger.info('Subscribed to %s/%s', symbol, timeframe);
            this.emit('subscribed', subscription);
            return true;
        }
        catch (err) {
            logger_1.logger.error('Failed to subscribe to %s/%s: %s', symbol, timeframe, err.message);
            this.emit('subscription_error', { subscription, error: err });
            return false;
        }
    }
    // Отписка от символа/таймфрейма
    async unsubscribe(symbol, timeframe) {
        const key = `${symbol}_${timeframe}`;
        const chart = this.charts.get(key);
        if (!chart) {
            logger_1.logger.warn('Cannot unsubscribe, subscription not found: %s/%s', symbol, timeframe);
            return false;
        }
        try {
            logger_1.logger.info('Unsubscribing from TradingView: %s/%s', symbol, timeframe);
            // Удаляем chart
            if (typeof chart.delete === 'function') {
                chart.delete();
                logger_1.logger.info('Chart.delete() called for %s/%s', symbol, timeframe);
            }
            else {
                logger_1.logger.warn('Chart.delete() not a function for %s/%s', symbol, timeframe);
            }
            this.charts.delete(key);
            metrics_1.subscriptionsGauge.set(this.charts.size);
            logger_1.logger.info('Unsubscribed from %s/%s, %d subscriptions remain', symbol, timeframe, this.charts.size);
            if (this.charts.size === 0) {
                logger_1.logger.info('All TradingView subscriptions removed, TradingView client is now idle');
            }
            this.emit('unsubscribed', { symbol, timeframe });
            return true;
        }
        catch (err) {
            logger_1.logger.error('Error unsubscribing from %s/%s: %s', symbol, timeframe, err.message);
            return false;
        }
    }
    // Получить список активных подписок
    getSubscriptions() {
        return Array.from(this.charts.keys()).map(key => {
            const [symbol, timeframe] = key.split('_');
            return { symbol, timeframe };
        });
    }
    // Обновить подписки (подписаться на новые и отписаться от ненужных)
    async updateSubscriptions(subscriptions) {
        const currentSubs = this.getSubscriptions();
        const currentKeys = new Set(currentSubs.map(s => `${s.symbol}_${s.timeframe}`));
        const newKeys = new Set(subscriptions.map(s => `${s.symbol}_${s.timeframe}`));
        // Отписаться от тех, которых нет в новом списке
        const toRemove = currentSubs.filter(s => !newKeys.has(`${s.symbol}_${s.timeframe}`));
        for (const sub of toRemove) {
            await this.unsubscribe(sub.symbol, sub.timeframe);
        }
        // Подписаться на новые
        const toAdd = subscriptions.filter(s => !currentKeys.has(`${s.symbol}_${s.timeframe}`));
        for (const sub of toAdd) {
            await this.subscribe(sub);
        }
        logger_1.logger.info('Subscriptions updated: removed %d, added %d', toRemove.length, toAdd.length);
    }
    close() {
        // Останавливаем мок-генерацию данных
        if (this.mockIntervalId) {
            clearInterval(this.mockIntervalId);
            this.mockIntervalId = null;
        }
        // Отменяем попытки переподключения
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        // Закрываем все подписки
        for (const [key, chart] of this.charts.entries()) {
            try {
                if (typeof chart.delete === 'function') {
                    chart.delete();
                }
            }
            catch (err) {
                logger_1.logger.error('Error closing chart %s: %s', key, err.message);
            }
        }
        this.charts.clear();
        metrics_1.subscriptionsGauge.set(0);
        // Закрываем соединение
        if (this.client && this.connected && typeof this.client.end === 'function') {
            try {
                this.client.end();
            }
            catch (err) {
                logger_1.logger.error('Error disconnecting from TradingView: %s', err.message);
            }
        }
        this.connected = false;
        this.emit('disconnect');
        logger_1.logger.info('TradingView client closed');
    }
}
exports.TradingViewClient = TradingViewClient;
