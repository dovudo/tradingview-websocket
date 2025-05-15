import { EventEmitter } from 'events';
import { config } from './config';
import type { Subscription } from './config';
import { logger } from './logger';
import { wsConnectsTotal, wsErrorsTotal, subscriptionsGauge } from './metrics';

// Импорт библиотеки TradingView из нашей локальной копии
// eslint-disable-next-line @typescript-eslint/no-var-requires
let TV;
try {
  TV = require('../tradingview_vendor/client');
  logger.info('TradingView loaded: %o', {
    type: typeof TV,
    isFunction: typeof TV === 'function',
    hasConstructor: TV && typeof TV.constructor === 'function',
    keys: TV ? Object.keys(TV) : []
  });
} catch (err) {
  logger.error('Error loading TradingView: %s', (err as Error).message);
  // Создаем заглушку для тестирования
  TV = {
    Client: function() {
      this.loginGuest = async () => Promise.resolve(true);
      this.Chart = function(symbol: string, options: any) {
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
          onUpdate: (cb: Function) => setTimeout(cb, 1000),
          setMarket: () => {},
          delete: () => {}
        };
      };
    }
  };
}

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
  private charts: Map<string, any> = new Map(); // Отслеживаем подписки для каждого символа
  private mockIntervalId: NodeJS.Timeout | number | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelay = 5000; // 5 секунд базовая задержка

  constructor() {
    super();
  }

  async connect() {
    try {
      logger.info('Creating TradingView client...');
      
      if (typeof TV.Client !== 'function') {
        logger.error('No TradingView.Client constructor, using mock');
        this.useMockClient();
      } else {
        // Используем TV.Client 
        try {
          this.client = new TV.Client();
          logger.info('TradingView client created successfully');
        } catch (err) {
          logger.error('Error creating TradingView client: %s', (err as Error).message);
          this.useMockClient();
        }
      }
      
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
    // Предотвращаем множественные попытки переподключения
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      this.emit('max_reconnect_attempts');
      return;
    }

    // Экспоненциальная задержка с джиттером для предотвращения thundering herd 
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1) * (1 + Math.random() * 0.2),
      60000 // максимум 1 минута
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

  // Мок-клиент для тестирования
  private useMockClient() {
    logger.warn('Using mock TradingView client');
    this.client = {
      Session: {
        Chart: function() {
          return {
            infos: {
              description: "Mock Market",
              currency_id: "USD"
            },
            periods: [] as any[],
            onError: function() {},
            onSymbolLoaded: function(cb: Function) { setTimeout(cb, 100); },
            onUpdate: function(cb: Function) { 
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
            setMarket: function(symbol: string, options: any) {
              this.infos.description = symbol;
              this.infos.currency_id = "USD";
              return true;
            },
            delete: function() {}
          };
        }
      },
      end: function() {}
    };
  }

  // Подписка на символ/таймфрейм
  async subscribe(subscription: Subscription): Promise<boolean> {
    if (!this.connected || !this.client) {
      logger.error('Cannot subscribe, client not connected');
      throw new Error('TradingView client not connected');
    }

    const { symbol, timeframe } = subscription;
    const key = `${symbol}_${timeframe}`;

    // Если уже есть такая подписка - ничего не делаем
    if (this.charts.has(key)) {
      logger.info('Already subscribed to %s/%s', symbol, timeframe);
      return true;
    }

    try {
      logger.info('Creating chart for %s/%s', symbol, timeframe);
      
      // Проверяем API
      if (!this.client.Session || typeof this.client.Session.Chart !== 'function') {
        logger.error('No Chart constructor in TradingView client, using mock');
        this.useMockClient();
        if (!this.client.Session || typeof this.client.Session.Chart !== 'function') {
          logger.error('Failed to initialize mock Chart');
          return false;
        }
      }
      
      // Создаем отдельный chart для символа/таймфрейма
      const chart = new this.client.Session.Chart();
      
      // Обработка ошибок
      chart.onError((...err: any[]) => {
        logger.error('Chart error for %s/%s: %o', symbol, timeframe, err);
        this.emit('chart_error', { symbol, timeframe, error: err });
      });
      
      // Когда символ загружен
      chart.onSymbolLoaded(() => {
        logger.info('Symbol loaded for %s/%s: %s', symbol, timeframe, chart.infos?.description || 'Unknown');
        this.emit('symbol_loaded', { symbol, timeframe, description: chart.infos?.description });
      });
      
      // Обработка обновлений данных
      const updateHandler = chart.onUpdate(() => {
        if (!chart.periods || !chart.periods[0]) return;
        
        // Получаем последний бар
        const lastBar = chart.periods[0];
        
        if (lastBar) {
          // Формируем бар для отправки
          const bar: Bar = {
            symbol,
            timeframe,
            time: lastBar.time,
            open: lastBar.open,
            high: lastBar.max,
            low: lastBar.min,
            close: lastBar.close,
            volume: lastBar.volume || 0,
          };
          
          logger.info('Got bar: %o', bar);
          
          // Отправляем бар слушателям
          this.emit('bar', bar);
        }
      });
      
      // Сохраняем intervalId для мок-клиента, если он вернулся
      if (typeof updateHandler === 'number') {
        this.mockIntervalId = updateHandler as number;
      }
      
      // Устанавливаем рынок
      chart.setMarket(symbol, {
        timeframe
      });
      
      // Сохраняем chart для этой подписки
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

  // Отписка от символа/таймфрейма
  async unsubscribe(symbol: string, timeframe: string): Promise<boolean> {
    const key = `${symbol}_${timeframe}`;
    const chart = this.charts.get(key);

    if (!chart) {
      logger.warn('Cannot unsubscribe, subscription not found: %s/%s', symbol, timeframe);
      return false;
    }

    try {
      logger.info('Unsubscribing from TradingView: %s/%s', symbol, timeframe);
      // Удаляем chart
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

  // Получить список активных подписок
  getSubscriptions(): Subscription[] {
    return Array.from(this.charts.keys()).map(key => {
      const [symbol, timeframe] = key.split('_');
      return { symbol, timeframe };
    });
  }

  // Обновить подписки (подписаться на новые и отписаться от ненужных)
  async updateSubscriptions(subscriptions: Subscription[]): Promise<void> {
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
    
    logger.info('Subscriptions updated: removed %d, added %d', toRemove.length, toAdd.length);
  }

  close() {
    // Останавливаем мок-генерацию данных
    if (this.mockIntervalId) {
      clearInterval(this.mockIntervalId as NodeJS.Timeout);
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
      } catch (err) {
        logger.error('Error closing chart %s: %s', key, (err as Error).message);
      }
    }
    
    this.charts.clear();
    subscriptionsGauge.set(0);
    
    // Закрываем соединение
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