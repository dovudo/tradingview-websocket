import axios from 'axios';
import { config } from './config';
import { logger } from './logger';
import { barsPushedTotal, httpPushLatency } from './metrics';
import type { Bar } from './tradingview';
import type { WebSocketServer } from './websocket';

// Optional WebSocket server
let wsServer: WebSocketServer | null = null;

// Set WebSocket server
export function setWebSocketServer(server: WebSocketServer) {
  wsServer = server;
  logger.info('WebSocket server set for push service');
}

// Function to push a bar to API and WebSocket clients
export async function pushBar(bar: Bar) {
  // If WebSocket server is set, broadcast bar to clients
  if (wsServer) {
    wsServer.broadcastBar(bar);
  }

  // If backend endpoint is not configured, do not push via HTTP
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