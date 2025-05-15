import WebSocket from 'ws';
import http from 'http';
import { EventEmitter } from 'events';
import { config } from './config';
import { logger } from './logger';
import { type Subscription } from './config';
import { type Bar } from './tradingview';

// WebSocket message types
export enum MessageType {
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  LIST = 'list',
  BAR = 'bar',
  ERROR = 'error',
  INFO = 'info',
  SUBSCRIBE_MANY = 'subscribe_many',
  UNSUBSCRIBE_MANY = 'unsubscribe_many',
}

// Client request type
export interface WSRequest {
  action: MessageType | string;
  symbol?: string;
  timeframe?: string;
  requestId?: string;
  pairs?: { symbol: string; timeframe: string }[];
}

// Server response type
export interface WSResponse {
  type: MessageType | string;
  requestId?: string;
  success?: boolean;
  message?: string;
  symbol?: string;
  timeframe?: string;
  subscriptions?: Subscription[];
  bar?: Bar;
  error?: string;
}

export class WebSocketServer extends EventEmitter {
  private wss: WebSocket.Server;
  private clients: Set<WebSocket> = new Set();
  private activeSubscriptions: Map<string, Subscription> = new Map();

  // New structures for per-client subscription tracking
  private clientSubscriptions: Map<WebSocket, Set<string>> = new Map();
  private subscriptionClients: Map<string, Set<WebSocket>> = new Map();

  constructor(server?: http.Server) {
    super();
    
    // Create WebSocket server
    const port = config.websocket?.port || 8081;
    
    if (server) {
      // Use existing HTTP server
      this.wss = new WebSocket.Server({ server });
      logger.info(`WebSocket server attached to existing HTTP server`);
    } else {
      // Create new WebSocket server
      this.wss = new WebSocket.Server({ port });
      logger.info(`WebSocket server started on port ${port}`);
    }

    // Handle new connections
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    // Handle server errors
    this.wss.on('error', (error) => {
      logger.error(`WebSocket server error: ${error.message}`);
    });
  }

  // Handle new connection
  private handleConnection(ws: WebSocket) {
    logger.info('New WebSocket client connected');
    this.clients.add(ws);
    this.clientSubscriptions.set(ws, new Set());

    // Send welcome message
    this.sendMessage(ws, {
      type: MessageType.INFO,
      success: true,
      message: 'Connected to TradingView WebSocket Server'
    });

    // Handle messages from client
    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message) as WSRequest;
        this.handleMessage(ws, data);
      } catch (error) {
        logger.error(`Failed to parse WebSocket message: ${error.message}`);
        this.sendMessage(ws, {
          type: MessageType.ERROR,
          success: false,
          message: 'Invalid JSON message'
        });
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
      this.clients.delete(ws);
      // Automatic unsubscription from all tickers subscribed to by this client
      const subs = this.clientSubscriptions.get(ws);
      if (subs) {
        for (const key of subs) {
          const clients = this.subscriptionClients.get(key);
          if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
              this.subscriptionClients.delete(key);
              const [symbol, timeframe] = key.split('_');
              this.activeSubscriptions.delete(key);
              this.emit('unsubscribe', { symbol, timeframe });
              logger.info('Auto-unsubscribed from %s/%s (last client disconnected)', symbol, timeframe);
            }
          }
        }
        this.clientSubscriptions.delete(ws);
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error(`WebSocket client error: ${error.message}`);
    });
  }

  // Handle incoming messages
  private handleMessage(ws: WebSocket, data: WSRequest) {
    logger.info(`Received WebSocket message: ${JSON.stringify(data)}`);

    switch (data.action) {
      case MessageType.SUBSCRIBE:
        this.handleSubscribe(ws, data);
        break;
      
      case MessageType.UNSUBSCRIBE:
        this.handleUnsubscribe(ws, data);
        break;
      
      case MessageType.LIST:
        this.handleList(ws, data);
        break;
      
      case MessageType.SUBSCRIBE_MANY:
        this.handleSubscribeMany(ws, data);
        break;
      
      case MessageType.UNSUBSCRIBE_MANY:
        this.handleUnsubscribeMany(ws, data);
        break;
      
      default:
        this.sendMessage(ws, {
          type: MessageType.ERROR,
          requestId: data.requestId,
          success: false,
          message: `Unknown action: ${data.action}`
        });
    }
  }

  // Handle subscription request
  private handleSubscribe(ws: WebSocket, data: WSRequest) {
    if (!data.symbol || !data.timeframe) {
      return this.sendMessage(ws, {
        type: MessageType.ERROR,
        requestId: data.requestId,
        success: false,
        message: 'Symbol and timeframe are required for subscription'
      });
    }

    const key = `${data.symbol}_${data.timeframe}`;
    // If there is already such a subscription for this client — just confirm
    const clientSubs = this.clientSubscriptions.get(ws) || new Set();
    if (clientSubs.has(key)) {
      return this.sendMessage(ws, {
        type: MessageType.SUBSCRIBE,
        requestId: data.requestId,
        success: true,
        message: 'Already subscribed',
        symbol: data.symbol,
        timeframe: data.timeframe
      });
    }
    // Add subscription for client
    clientSubs.add(key);
    this.clientSubscriptions.set(ws, clientSubs);
    // Add client to ticker listener list
    let clients = this.subscriptionClients.get(key);
    let isFirst = false;
    if (!clients) {
      clients = new Set();
      this.subscriptionClients.set(key, clients);
      isFirst = true;
    }
    clients.add(ws);
    // If this is the first subscription to the ticker — create TradingView subscription
    if (isFirst) {
      const subscription: Subscription = { symbol: data.symbol, timeframe: data.timeframe };
      this.activeSubscriptions.set(key, subscription);
      this.emit('subscribe', subscription);
      logger.info('First client subscribed to %s/%s, subscribing to TradingView', data.symbol, data.timeframe);
    }
    // Confirm to client
    this.sendMessage(ws, {
      type: MessageType.SUBSCRIBE,
      requestId: data.requestId,
      success: true,
      message: isFirst ? 'Subscription created' : 'Subscribed (shared)',
      symbol: data.symbol,
      timeframe: data.timeframe
    });
  }

  // Handle unsubscription request
  private handleUnsubscribe(ws: WebSocket, data: WSRequest) {
    if (!data.symbol || !data.timeframe) {
      return this.sendMessage(ws, {
        type: MessageType.ERROR,
        requestId: data.requestId,
        success: false,
        message: 'Symbol and timeframe are required for unsubscription'
      });
    }

    const key = `${data.symbol}_${data.timeframe}`;
    const clientSubs = this.clientSubscriptions.get(ws);
    if (!clientSubs || !clientSubs.has(key)) {
      return this.sendMessage(ws, {
        type: MessageType.UNSUBSCRIBE,
        requestId: data.requestId,
        success: false,
        message: 'Subscription not found for this client',
        symbol: data.symbol,
        timeframe: data.timeframe
      });
    }
    clientSubs.delete(key);
    // Remove client from ticker listener list
    const clients = this.subscriptionClients.get(key);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        this.subscriptionClients.delete(key);
        this.activeSubscriptions.delete(key);
        this.emit('unsubscribe', { symbol: data.symbol, timeframe: data.timeframe });
        logger.info('Last client unsubscribed from %s/%s, unsubscribing from TradingView', data.symbol, data.timeframe);
      }
    }
    // Confirm to client
    this.sendMessage(ws, {
      type: MessageType.UNSUBSCRIBE,
      requestId: data.requestId,
      success: true,
      message: 'Unsubscribed successfully',
      symbol: data.symbol,
      timeframe: data.timeframe
    });
  }

  // Handle get subscription list request
  private handleList(ws: WebSocket, data: WSRequest) {
    const subscriptions = Array.from(this.activeSubscriptions.values());
    
    this.sendMessage(ws, {
      type: MessageType.LIST,
      requestId: data.requestId,
      success: true,
      subscriptions
    });
  }

  // Bulk subscription
  private handleSubscribeMany(ws: WebSocket, data: WSRequest) {
    if (!Array.isArray(data.pairs) || data.pairs.length === 0) {
      return this.sendMessage(ws, {
        type: MessageType.ERROR,
        requestId: data.requestId,
        success: false,
        message: 'pairs[] required for subscribe_many'
      });
    }
    const results = data.pairs.map(pair => {
      if (!pair.symbol || !pair.timeframe) {
        return { ...pair, success: false, message: 'symbol and timeframe required' };
      }
      const key = `${pair.symbol}_${pair.timeframe}`;
      if (this.activeSubscriptions.has(key)) {
        return { ...pair, success: true, message: 'Already subscribed' };
      }
      const subscription: Subscription = { symbol: pair.symbol, timeframe: pair.timeframe };
      this.activeSubscriptions.set(key, subscription);
      this.emit('subscribe', subscription);
      return { ...pair, success: true, message: 'Subscription created' };
    });
    this.sendMessage(ws, {
      type: MessageType.SUBSCRIBE_MANY,
      requestId: data.requestId,
      success: true,
      message: 'Bulk subscribe processed',
      subscriptions: this.getActiveSubscriptions(),
      results
    } as any);
  }

  // Bulk unsubscription
  private handleUnsubscribeMany(ws: WebSocket, data: WSRequest) {
    if (!Array.isArray(data.pairs) || data.pairs.length === 0) {
      return this.sendMessage(ws, {
        type: MessageType.ERROR,
        requestId: data.requestId,
        success: false,
        message: 'pairs[] required for unsubscribe_many'
      });
    }
    const results = data.pairs.map(pair => {
      if (!pair.symbol || !pair.timeframe) {
        return { ...pair, success: false, message: 'symbol and timeframe required' };
      }
      const key = `${pair.symbol}_${pair.timeframe}`;
      if (!this.activeSubscriptions.has(key)) {
        return { ...pair, success: false, message: 'Subscription not found' };
      }
      this.activeSubscriptions.delete(key);
      this.emit('unsubscribe', { symbol: pair.symbol, timeframe: pair.timeframe });
      return { ...pair, success: true, message: 'Unsubscribed successfully' };
    });
    this.sendMessage(ws, {
      type: MessageType.UNSUBSCRIBE_MANY,
      requestId: data.requestId,
      success: true,
      message: 'Bulk unsubscribe processed',
      subscriptions: this.getActiveSubscriptions(),
      results
    } as any);
  }

  // Send message to client
  private sendMessage(ws: WebSocket, data: WSResponse) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // Send bar to all connected clients
  public broadcastBar(bar: Bar) {
    const message: WSResponse = {
      type: MessageType.BAR,
      bar
    };
    
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  // Get list of active subscriptions
  public getActiveSubscriptions(): Subscription[] {
    return Array.from(this.activeSubscriptions.values());
  }

  // Check if subscription exists
  public hasSubscription(symbol: string, timeframe: string): boolean {
    return this.activeSubscriptions.has(`${symbol}_${timeframe}`);
  }

  // Add subscription programmatically (without client request)
  public addSubscription(subscription: Subscription) {
    const key = `${subscription.symbol}_${subscription.timeframe}`;
    if (!this.activeSubscriptions.has(key)) {
      this.activeSubscriptions.set(key, subscription);
      this.emit('subscribe', subscription);
      return true;
    }
    return false;
  }

  // Remove subscription programmatically (without client request)
  public removeSubscription(symbol: string, timeframe: string) {
    const key = `${symbol}_${timeframe}`;
    if (this.activeSubscriptions.has(key)) {
      this.activeSubscriptions.delete(key);
      this.emit('unsubscribe', { symbol, timeframe });
      return true;
    }
    return false;
  }

  // Close all connections and stop server
  public close() {
    this.wss.close(() => {
      logger.info('WebSocket server closed');
    });
  }
} 