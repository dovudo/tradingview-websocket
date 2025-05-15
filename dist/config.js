"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function parseSubscriptions() {
    const raw = process.env.SUBSCRIPTIONS;
    if (!raw)
        return [];
    try {
        return JSON.parse(raw);
    }
    catch {
        throw new Error('SUBSCRIPTIONS must be valid JSON');
    }
}
function normalizeTimeframe(sub) {
    let { timeframe } = sub;
    // TradingView API особенности: '1m' -> '1', '1h' -> '60', etc.
    if (timeframe.endsWith('m')) {
        timeframe = timeframe.replace('m', '');
    }
    else if (timeframe.endsWith('h')) {
        timeframe = (parseInt(timeframe) * 60).toString();
    }
    else if (timeframe === '1d' || timeframe === 'd') {
        timeframe = 'D';
    }
    else if (timeframe === '1w' || timeframe === 'w') {
        timeframe = 'W';
    }
    else if (timeframe === '1M' || timeframe === 'M') {
        timeframe = 'M';
    }
    return { ...sub, timeframe };
}
exports.config = {
    tvApi: {
        proxy: process.env.TV_API_PROXY || null,
        timeoutMs: Number(process.env.TV_API_TIMEOUT_MS) || 10000,
    },
    subscriptions: parseSubscriptions().map(normalizeTimeframe),
    backend: {
        endpoint: process.env.BACKEND_ENDPOINT || '',
        apiKey: process.env.BACKEND_API_KEY || '',
    },
    metrics: {
        port: Number(process.env.METRICS_PORT) || 9100,
    },
    log: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || './logs/tv-fetcher.log',
    },
    websocket: {
        port: Number(process.env.WEBSOCKET_PORT) || 8081,
        enabled: process.env.WEBSOCKET_ENABLED !== 'false',
    },
};
