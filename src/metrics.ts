import client from 'prom-client';
import { config } from './config';
import { logger } from './logger';
import express, { Request, Response } from 'express';

export const wsConnectsTotal = new client.Counter({
  name: 'tv_ws_connects_total',
  help: 'Total WebSocket connections',
});
export const wsErrorsTotal = new client.Counter({
  name: 'tv_ws_errors_total',
  help: 'Total WebSocket connection errors',
});
export const barsPushedTotal = new client.Counter({
  name: 'tv_bars_pushed_total',
  help: 'Total bars pushed to backend',
});
export const httpPushLatency = new client.Histogram({
  name: 'tv_http_push_latency_seconds',
  help: 'HTTP push latency in seconds',
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});
export const subscriptionsGauge = new client.Gauge({
  name: 'tv_active_subscriptions',
  help: 'Current number of active subscriptions',
});

export function startMetricsServer(port: number) {
  const app = express();
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  });
  app.listen(port, () => {
    logger.info(`Prometheus metrics server started on :${port}`);
  });
} 