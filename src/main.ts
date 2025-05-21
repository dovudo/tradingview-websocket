import { config } from './config';
import { logger } from './logger';
import { startMetricsServer } from './metrics';
import { TradingViewClient } from './tradingview';
import { pushBar, setWebSocketServer, setTradingViewClient } from './push';
import { WebSocketServer } from './websocket';
import { TradingViewHealthMonitor } from './health';
import { HealthApiServer } from './health-api';

logger.info('tv-fetcher starting...');
logger.info('Config: %o', config);

// Start metrics server for monitoring
const metricsPort = config.metrics.port;
startMetricsServer(metricsPort);

// Create TradingView client
let tvClient: TradingViewClient;

// Health monitor instance
let healthMonitor: TradingViewHealthMonitor;

// Health API server
let healthApiServer: HealthApiServer;

// Create WebSocket server if enabled
let wsServer: WebSocketServer | null = null;
if (config.websocket.enabled) {
  const wsPort = config.websocket.port;
  wsServer = new WebSocketServer();
  setWebSocketServer(wsServer);
  
  // Handle subscriptions via WebSocket
  wsServer.on('subscribe', async (subscription) => {
    logger.info('WebSocket requested subscription: %o', subscription);
    await tvClient.subscribe(subscription);
  });
  
  wsServer.on('unsubscribe', async ({ symbol, timeframe }) => {
    logger.info('WebSocket requested unsubscription: %s/%s', symbol, timeframe);
    await tvClient.unsubscribe(symbol, timeframe);
  });
  
  logger.info('WebSocket server started on port %d', wsPort);
}

// Function to start and subscribe to initial symbols
async function start() {
  // Create TradingView client
  tvClient = new TradingViewClient();
  setTradingViewClient(tvClient);
  
  // Create health monitor
  healthMonitor = new TradingViewHealthMonitor(tvClient, config.health);
  
  // Create health API server
  healthApiServer = new HealthApiServer(config.health.apiPort);
  healthApiServer.setTradingViewClient(tvClient);
  healthApiServer.setHealthMonitor(healthMonitor);
  
  // Handle health monitor events
  healthMonitor.on('stale_subscriptions', ({ total, stale, recovered }) => {
    logger.warn('Health monitor detected %d/%d stale subscriptions, recovered %d', stale, total, recovered);
  });
  
  healthMonitor.on('max_recovery_attempts', (subscription) => {
    logger.error(
      'Health monitor reached max recovery attempts for %s/%s, manual intervention may be needed',
      subscription.symbol, subscription.timeframe
    );
  });
  
  // Handle errors
  tvClient.on('error', (err) => {
    logger.error('TradingView error: %s', (err as Error).message);
  });
  
  // Handle disconnection
  tvClient.on('disconnect', () => {
    logger.warn('TradingView disconnected, reconnecting...');
  });
  
  // Handle receiving bars
  tvClient.on('bar', async (bar) => {
    try {
      await pushBar(bar);
    } catch (err) {
      logger.error('Push error: %s', (err as Error).message);
    }
  });
  
  // Connect
  await tvClient.connect();
  
  // If there are initial subscriptions in the configuration, subscribe
  if (config.subscriptions.length > 0) {
    logger.info('Subscribing to initial %d pairs from config', config.subscriptions.length);
    await tvClient.updateSubscriptions(config.subscriptions);
  }
}

// Start application
start().catch((err) => {
  logger.error('Failed to start: %s', err.message);
  process.exit(1);
});

// Handle termination signals
process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  if (healthApiServer) healthApiServer.stop();
  if (healthMonitor) healthMonitor.stop();
  if (wsServer) wsServer.close();
  if (tvClient) tvClient.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  if (healthApiServer) healthApiServer.stop();
  if (healthMonitor) healthMonitor.stop();
  if (wsServer) wsServer.close();
  if (tvClient) tvClient.close();
  process.exit(0);
}); 