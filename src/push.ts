import axios from 'axios';
import { config } from './config';
import { logger } from './logger';
import { barsPushedTotal, httpPushLatency } from './metrics';
import type { Bar } from './tradingview';
import type { WebSocketServer } from './websocket';

// WebSocket сервер (опционально)
let wsServer: WebSocketServer | null = null;

// Установка WebSocket сервера
export function setWebSocketServer(server: WebSocketServer) {
  wsServer = server;
  logger.info('WebSocket server set for push service');
}

// Функция для отправки бара в API и WebSocket клиентам
export async function pushBar(bar: Bar) {
  // Если есть WebSocket сервер, отправляем данные через него
  if (wsServer) {
    wsServer.broadcastBar(bar);
  }

  // Если конфигурация backend отключена, не отправляем по HTTP
  if (!config.backend.endpoint) {
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
    'X-Api-Key': config.backend.apiKey,
  };
  let attempt = 0;
  const maxAttempts = 1 + (config as any).retry?.httpRetry?.attempts || 3;
  const backoffSec = (config as any).retry?.httpRetry?.backoffSec || 1;
  while (attempt < maxAttempts) {
    const end = httpPushLatency.startTimer();
    try {
      await axios.post(config.backend.endpoint, payload, { headers });
      barsPushedTotal.inc();
      logger.debug('Pushed bar: %o', payload);
      end();
      return;
    } catch (err) {
      end();
      logger.error('Failed to push bar (attempt %d): %s', attempt + 1, (err as Error).message);
      attempt++;
      if (attempt < maxAttempts) await new Promise(res => setTimeout(res, backoffSec * 1000));
    }
  }
  logger.error('Giving up on pushing bar after %d attempts', maxAttempts);
} 