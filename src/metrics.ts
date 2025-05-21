import express from 'express';
import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import { logger } from './logger';

// Create a registry
const registry = new Registry();

// Collect default metrics
registry.setDefaultLabels({
  app: 'tv-fetcher'
});

// Bars pushed counter
export const barsPushedTotal = new Counter({
  name: 'bars_pushed_total',
  help: 'Total number of bars pushed to backend',
  registers: [registry]
});

// WebSocket connections counter
export const wsConnectsTotal = new Counter({
  name: 'ws_connects_total',
  help: 'Total number of TradingView WebSocket connections',
  registers: [registry]
});

// WebSocket error counter
export const wsErrorsTotal = new Counter({
  name: 'ws_errors_total',
  help: 'Total number of TradingView WebSocket errors',
  registers: [registry]
});

// Active subscriptions gauge
export const subscriptionsGauge = new Gauge({
  name: 'active_subscriptions',
  help: 'Number of active TradingView subscriptions',
  registers: [registry]
});

// HTTP push latency
export const httpPushLatency = new Histogram({
  name: 'http_push_latency_seconds',
  help: 'Latency of HTTP push requests to backend',
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry]
});

// Health metrics
export const staleSubscriptionsGauge = new Gauge({
  name: 'stale_subscriptions',
  help: 'Number of stale subscriptions detected',
  registers: [registry]
});

export const recoveryAttemptsTotal = new Counter({
  name: 'recovery_attempts_total',
  help: 'Total number of recovery attempts',
  registers: [registry]
});

export const successfulRecoveriesTotal = new Counter({
  name: 'successful_recoveries_total',
  help: 'Total number of successful recoveries',
  registers: [registry]
});

export const failedRecoveriesTotal = new Counter({
  name: 'failed_recoveries_total',
  help: 'Total number of failed recoveries',
  registers: [registry]
});

export const fullReconnectsTotal = new Counter({
  name: 'full_reconnects_total',
  help: 'Total number of full TradingView reconnections',
  registers: [registry]
});

export const lastDataReceivedGauge = new Gauge({
  name: 'last_data_received_seconds',
  help: 'Time since last data was received for a subscription',
  labelNames: ['symbol', 'timeframe'],
  registers: [registry]
});

// Function to start metrics server
export function startMetricsServer(port: number) {
  const app = express();
  
  // Metrics endpoint
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });
  
  // Start server
  app.listen(port, () => {
    logger.info(`Metrics server started on port ${port}`);
  });
} 