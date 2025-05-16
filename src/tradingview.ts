import { EventEmitter } from 'events';
import { config } from './config';
import type { Subscription } from './config';
import { logger } from './logger';
import { wsConnectsTotal, wsErrorsTotal, subscriptionsGauge } from './metrics';

// Import TradingView API from local vendor directory
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TradingViewAPI = require('../tradingview_vendor/main');

export interface Bar {
  symbol: string;
  timeframe: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class TradingViewClient extends EventEmitter {
  private client: any;
  private connected = false;
  private charts: Map<string, any> = new Map(); // Track subscriptions for each symbol
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelay = 5000; // 5 seconds base delay

  constructor() {
    super();
  }

  async connect() {
    try {
      logger.info('Creating TradingView client...');
      
      // Create TradingView API client
      this.client = new TradingViewAPI.Client({
        // Use proxy if specified in config
        proxy: config.tvApi.proxy || undefined,
        // Set connection timeout
        timeout_ms: config.tvApi.timeoutMs
      });
      
      logger.info('TradingView client created successfully');
      
      if (!this.client) {
        throw new Error('Could not initialize TradingView client');
      }
      
      this.connected = true;
      this.reconnectAttempts = 0;
      wsConnectsTotal.inc();
      this.emit('connect');
    } catch (err) {
      logger.error('Failed to connect TradingView WS: %s', (err as Error).message);
      wsErrorsTotal.inc();
      this.emit('error', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    // Prevent multiple reconnect attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      this.emit('max_reconnect_attempts');
      return;
    }

    // Exponential backoff with jitter to prevent thundering herd
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1) * (1 + Math.random() * 0.2),
      60000 // max 1 minute
    );

    logger.info(`Scheduling reconnect in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      logger.info('Reconnecting TradingView...');
      this.connect().catch(err => {
        logger.error('Reconnect failed:', err);
        this.scheduleReconnect();
      });
    }, delay);
  }

  // Subscribe to symbol/timeframe
  async subscribe(subscription: Subscription): Promise<boolean> {
    if (!this.connected || !this.client) {
      logger.error('Cannot subscribe, client not connected');
      throw new Error('TradingView client not connected');
    }

    const { symbol, timeframe } = subscription;
    const key = `${symbol}_${timeframe}`;

    // If already subscribed, do nothing
    if (this.charts.has(key)) {
      logger.info('Already subscribed to %s/%s', symbol, timeframe);
      return true;
    }

    try {
      logger.info('Creating chart for %s/%s', symbol, timeframe);
      
      // Create separate chart for symbol/timeframe
      const chart = new this.client.Session.Chart();
      
      // Handle errors
      chart.onError((...err: any[]) => {
        logger.error('Chart error for %s/%s: %o', symbol, timeframe, err);
        this.emit('chart_error', { symbol, timeframe, error: err });
      });
      
      // When symbol is loaded
      chart.onSymbolLoaded(() => {
        logger.info('Symbol loaded for %s/%s: %s', symbol, timeframe, chart.infos?.description || 'Unknown');
        this.emit('symbol_loaded', { symbol, timeframe, description: chart.infos?.description });
      });
      
      // Handle data updates
      chart.onUpdate(() => {
        if (!chart.periods || !chart.periods[0]) return;
        
        // Get last bar
        const lastBar = chart.periods[0];
        
        if (lastBar) {
          // Prepare bar for push
          const bar: Bar = {
            symbol,
            timeframe,
            time: lastBar.time,
            open: lastBar.open,
            high: lastBar.max || lastBar.high, // Support for different data formats
            low: lastBar.min || lastBar.low,   // Support for different data formats
            close: lastBar.close,
            volume: lastBar.volume || 0,
          };
          
          logger.debug('Got bar: %o', bar);
          
          // Emit bar to listeners
          this.emit('bar', bar);
        }
      });
      
      // Set market
      chart.setMarket(symbol, {
        timeframe
      });
      
      // Save chart for this subscription
      this.charts.set(key, chart);
      subscriptionsGauge.set(this.charts.size);

      logger.info('Subscribed to %s/%s', symbol, timeframe);
      this.emit('subscribed', subscription);
      
      return true;
    } catch (err) {
      logger.error('Failed to subscribe to %s/%s: %s', symbol, timeframe, (err as Error).message);
      this.emit('subscription_error', { subscription, error: err });
      return false;
    }
  }

  // Unsubscribe from symbol/timeframe
  async unsubscribe(symbol: string, timeframe: string): Promise<boolean> {
    const key = `${symbol}_${timeframe}`;
    const chart = this.charts.get(key);

    if (!chart) {
      logger.warn('Cannot unsubscribe, subscription not found: %s/%s', symbol, timeframe);
      return false;
    }

    try {
      logger.info('Unsubscribing from TradingView: %s/%s', symbol, timeframe);
      // Delete chart
      if (typeof chart.delete === 'function') {
        chart.delete();
        logger.info('Chart.delete() called for %s/%s', symbol, timeframe);
      } else {
        logger.warn('Chart.delete() not a function for %s/%s', symbol, timeframe);
      }
      this.charts.delete(key);
      subscriptionsGauge.set(this.charts.size);
      logger.info('Unsubscribed from %s/%s, %d subscriptions remain', symbol, timeframe, this.charts.size);
      if (this.charts.size === 0) {
        logger.info('All TradingView subscriptions removed, TradingView client is now idle');
      }
      this.emit('unsubscribed', { symbol, timeframe });
      return true;
    } catch (err) {
      logger.error('Error unsubscribing from %s/%s: %s', symbol, timeframe, (err as Error).message);
      return false;
    }
  }

  // Get list of active subscriptions
  getSubscriptions(): Subscription[] {
    return Array.from(this.charts.keys()).map(key => {
      const [symbol, timeframe] = key.split('_');
      return { symbol, timeframe };
    });
  }

  // Update subscriptions (subscribe to new and unsubscribe from removed)
  async updateSubscriptions(subscriptions: Subscription[]): Promise<void> {
    const currentSubs = this.getSubscriptions();
    const currentKeys = new Set(currentSubs.map(s => `${s.symbol}_${s.timeframe}`));
    const newKeys = new Set(subscriptions.map(s => `${s.symbol}_${s.timeframe}`));
    
    // Unsubscribe from those not in the new list
    const toRemove = currentSubs.filter(s => !newKeys.has(`${s.symbol}_${s.timeframe}`));
    for (const sub of toRemove) {
      await this.unsubscribe(sub.symbol, sub.timeframe);
    }
    
    // Subscribe to new ones
    const toAdd = subscriptions.filter(s => !currentKeys.has(`${s.symbol}_${s.timeframe}`));
    for (const sub of toAdd) {
      await this.subscribe(sub);
    }
    
    logger.info('Subscriptions updated: removed %d, added %d', toRemove.length, toAdd.length);
  }

  close() {
    // Cancel reconnect attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Close all subscriptions
    for (const [key, chart] of this.charts.entries()) {
      try {
        if (typeof chart.delete === 'function') {
          chart.delete();
        }
      } catch (err) {
        logger.error('Error closing chart %s: %s', key, (err as Error).message);
      }
    }
    
    this.charts.clear();
    subscriptionsGauge.set(0);
    
    // Close connection
    if (this.client && this.connected && typeof this.client.end === 'function') {
      try {
        this.client.end();
      } catch (err) {
        logger.error('Error disconnecting from TradingView: %s', (err as Error).message);
      }
    }
    
    this.connected = false;
    this.emit('disconnect');
    logger.info('TradingView client closed');
  }
} 