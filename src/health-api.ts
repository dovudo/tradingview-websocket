import express from 'express';
import { logger } from './logger';
import { config } from './config';
import { TradingViewClient } from './tradingview';
import { TradingViewHealthMonitor } from './health';
import { staleSubscriptionsGauge } from './metrics';

// Health API server
export class HealthApiServer {
  private app: express.Express;
  private server: any;
  private tvClient: TradingViewClient | null = null;
  private healthMonitor: TradingViewHealthMonitor | null = null;
  
  constructor(port: number = config.health?.apiPort || 8082) {
    this.app = express();
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      // Basic health check
      const healthy = this.isHealthy();
      
      const healthStatus = {
        status: healthy ? 'healthy' : 'unhealthy',
        version: process.env.npm_package_version || 'unknown',
        uptime: process.uptime(),
        tradingview: {
          connected: this.tvClient?.isConnected() || false,
          subscriptions: this.tvClient?.getSubscriptions().length || 0,
        },
        health_monitor: {
          active: !!this.healthMonitor,
          stale_subscriptions: staleSubscriptionsGauge.get() || 0,
        },
        timestamp: new Date().toISOString()
      };
      
      res.status(healthy ? 200 : 503).json(healthStatus);
    });
    
    // Detailed status endpoint
    this.app.get('/status', (req, res) => {
      // Detailed status with subscriptions
      const subscriptions = this.tvClient?.getSubscriptions() || [];
      
      const statusInfo = {
        status: this.isHealthy() ? 'healthy' : 'unhealthy',
        version: process.env.npm_package_version || 'unknown',
        uptime: process.uptime(),
        tradingview: {
          connected: this.tvClient?.isConnected() || false,
          subscriptions_count: subscriptions.length,
          subscriptions: subscriptions,
        },
        health_monitor: {
          active: !!this.healthMonitor,
          stale_subscriptions: staleSubscriptionsGauge.get() || 0,
          check_interval_ms: config.health.checkIntervalMs,
          auto_recovery: config.health.autoRecoveryEnabled,
        },
        timestamp: new Date().toISOString()
      };
      
      res.json(statusInfo);
    });
    
    // Recovery trigger endpoint - for manual recovery
    this.app.post('/recovery/subscription', express.json(), (req, res) => {
      const { symbol, timeframe } = req.body;
      
      if (!symbol || !timeframe) {
        return res.status(400).json({
          status: 'error',
          message: 'Symbol and timeframe are required'
        });
      }
      
      if (!this.tvClient) {
        return res.status(503).json({
          status: 'error',
          message: 'TradingView client not available'
        });
      }
      
      // Trigger manual recovery
      const subscription = { symbol, timeframe };
      logger.info('[HEALTH-API] Manual recovery request for %s/%s', symbol, timeframe);
      
      // Unsubscribe and resubscribe
      this.tvClient.unsubscribe(symbol, timeframe)
        .then(() => new Promise(resolve => setTimeout(resolve, 1000)))
        .then(() => this.tvClient?.subscribe(subscription, 'manual_recovery'))
        .then(success => {
          if (success) {
            res.json({
              status: 'success',
              message: `Successfully resubscribed to ${symbol}/${timeframe}`
            });
          } else {
            res.status(500).json({
              status: 'error',
              message: `Failed to resubscribe to ${symbol}/${timeframe}`
            });
          }
        })
        .catch(err => {
          res.status(500).json({
            status: 'error',
            message: `Error during recovery: ${err.message}`
          });
        });
    });
    
    // Full reconnect endpoint - for manual reconnect
    this.app.post('/recovery/full-reconnect', (req, res) => {
      if (!this.tvClient || typeof this.tvClient.fullReconnect !== 'function') {
        return res.status(503).json({
          status: 'error',
          message: 'TradingView client not available or fullReconnect not supported'
        });
      }
      
      logger.info('[HEALTH-API] Manual full reconnect request');
      
      // Trigger full reconnect
      this.tvClient.fullReconnect()
        .then(success => {
          if (success) {
            res.json({
              status: 'success',
              message: 'Full reconnect successful'
            });
          } else {
            res.status(500).json({
              status: 'error',
              message: 'Full reconnect failed'
            });
          }
        })
        .catch(err => {
          res.status(500).json({
            status: 'error',
            message: `Error during full reconnect: ${err.message}`
          });
        });
    });
    
    // Start server
    this.server = this.app.listen(port, () => {
      logger.info(`Health API server started on port ${port}`);
    });
  }
  
  /**
   * Set the TradingView client to monitor
   */
  public setTradingViewClient(client: TradingViewClient): void {
    this.tvClient = client;
  }
  
  /**
   * Set the health monitor to expose stats from
   */
  public setHealthMonitor(monitor: TradingViewHealthMonitor): void {
    this.healthMonitor = monitor;
  }
  
  /**
   * Check if the service is healthy
   */
  private isHealthy(): boolean {
    // Check basic health: TradingView client is connected
    const connected = this.tvClient?.isConnected() || false;
    
    // Could add more checks here if needed
    return connected;
  }
  
  /**
   * Stop the health API server
   */
  public stop(): void {
    if (this.server) {
      this.server.close(() => {
        logger.info('Health API server stopped');
      });
    }
  }
} 