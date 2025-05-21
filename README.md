# TradingView Fetcher

A microservice for fetching real-time OHLCV data from TradingView and broadcasting it via a WebSocket API. Supports dynamic subscription management, resilience, and Prometheus metrics.

**All code comments and documentation are in English.**

## Features

- Real-time data from TradingView
- WebSocket API for dynamic symbol subscription management
- Broadcasts price updates via WebSocket
- HTTP API integration for pushing data to external systems
- Prometheus metrics monitoring
- Configurable logging
- Automatic reconnection on failure
- Proxy support (optional)
- Docker-ready for easy deployment
- **Detailed price logging for diagnostics (see below)**

## Installation

### From Source

```bash
# Clone the repository
git clone <repository-url>
cd tv-fetcher

# Install dependencies
npm install

# Build the project
npm run build

# Start the service
npm start
```

### Using Docker

```bash
# Build the image
docker build -t tv-fetcher .

# Run the container
docker run -p 8081:8081 -p 9100:9100 --env-file .env tv-fetcher
```

### Using Docker Compose

```bash
docker-compose up -d
```

## Configuration

Copy `.env.example` to `.env` and set your parameters:

```bash
cp .env.example .env
```

### Configuration Parameters

| Variable             | Description                                                      | Default                |
|----------------------|------------------------------------------------------------------|------------------------|
| `TV_API_PROXY`       | Proxy for TradingView API (optional)                              | (empty)                |
| `TV_API_TIMEOUT_MS`  | Timeout for TradingView API requests (ms)                         | 10000                  |
| `SUBSCRIPTIONS`      | JSON array of initial subscriptions                               | `[{"symbol":"BINANCE:BTCUSDT","timeframe":"1"}]` |
| `BACKEND_ENDPOINT`   | HTTP endpoint for pushing data                                    | (empty)                |
| `BACKEND_API_KEY`    | API key for pushing data                                          | (empty)                |
| `WEBSOCKET_PORT`     | WebSocket server port                                             | 8081                   |
| `WEBSOCKET_ENABLED`  | Enable WebSocket API                                              | true                   |
| `METRICS_PORT`       | Prometheus metrics port                                           | 9100                   |
| `LOG_LEVEL`          | Logging level (debug, info, warn, error)                         | info                   |
| `LOG_FILE`           | Log file path                                                    | ./logs/tv-fetcher.log  |
| `DEBUG_PRICES`       | Enable detailed price logging (true/false)                       | false                  |
| `PRICES_LOG_FILE`    | File to log all received price bars if DEBUG_PRICES is true       | ./logs/prices.log      |
| `HEALTH_CHECK_INTERVAL_MS` | How often to check for stale subscriptions (ms)            | 60000                  |
| `HEALTH_STALE_THRESHOLD_MULTIPLIER` | Multiplier for stale detection (timeframe × multiplier) | 3                |
| `HEALTH_AUTO_RECOVERY_ENABLED` | Enable automatic recovery of stale subscriptions       | true                   |
| `HEALTH_MAX_RECOVERY_ATTEMPTS` | Maximum recovery attempts per subscription             | 3                      |
| `HEALTH_FULL_RECONNECT_THRESHOLD` | Stale subscriptions count to trigger full reconnect | 3                      |
| `HEALTH_FULL_RECONNECT_COOLDOWN_MS` | Cooldown between full reconnects (ms)             | 600000                 |

#### Detailed Price Logging

If you set `DEBUG_PRICES=true` in your `.env`, every price bar received from TradingView will be logged in detail to the file specified by `PRICES_LOG_FILE` (default: `./logs/prices.log`).

Each log entry will include the symbol, timeframe, timestamp, open, high, low, close, and volume, e.g.:

```
2024-05-16T14:00:00.000Z [PRICE] BINANCE:BTCUSDT/1 2024-05-16T14:00:00.000Z O:65000.00 H:65100.00 L:64900.00 C:65050.00 V:12.34
```

This is useful for diagnostics and for verifying exactly what data is being received from TradingView, especially if you suspect issues with data delivery or backend integration.

### Timeframes

TradingView API uses the following timeframe formats:

| Human format | TradingView API format |
|--------------|-------------------------|
| 1 minute     | "1"                     |
| 5 minutes    | "5"                     |
| 15 minutes   | "15"                    |
| 30 minutes   | "30"                    |
| 1 hour       | "60"                    |
| 4 hours      | "240"                   |
| 1 day        | "D"                     |
| 1 week       | "W"                     |
| 1 month      | "M"                     |

## Health Monitoring System

This service includes a comprehensive health monitoring system for TradingView data flow, ensuring reliable data delivery under all conditions.

### How It Works

1. **Data Flow Monitoring**: The system tracks the timestamp of the last bar received for each subscription.
2. **Stale Detection**: A subscription is considered "stale" if no data has been received for longer than expected (timeframe duration × multiplier).
3. **Auto-Recovery**: When stale subscriptions are detected, the system automatically attempts recovery through targeted resubscription.
4. **Progressive Recovery**: Multiple recovery strategies are employed based on the severity of the issue:
   - **Individual Recovery**: First attempts to unsubscribe and resubscribe to the affected symbol/timeframe.
   - **Full Reconnection**: If multiple subscriptions become stale, performs a complete TradingView reconnection.

### Health Monitoring Configuration

The health monitoring system is configurable through the following environment variables:

- `HEALTH_CHECK_INTERVAL_MS`: How often to check for stale subscriptions (default: 60000 ms)
- `HEALTH_STALE_THRESHOLD_MULTIPLIER`: How many timeframe intervals to wait before considering a subscription stale (default: 3)
- `HEALTH_AUTO_RECOVERY_ENABLED`: Enable/disable automatic recovery attempts (default: true)
- `HEALTH_MAX_RECOVERY_ATTEMPTS`: Maximum recovery attempts per subscription before giving up (default: 3)
- `HEALTH_FULL_RECONNECT_THRESHOLD`: Number of stale subscriptions that triggers a full reconnect (default: 3)
- `HEALTH_FULL_RECONNECT_COOLDOWN_MS`: Minimum time between full reconnects (default: 600000 ms)

### Health Monitoring Logs

The health monitoring system logs detailed information about its operation with the `[HEALTH]` prefix:

```
[HEALTH] Stale subscription detected for BINANCE:BTCUSDT/1 - no data for 3m 45s (threshold: 180s)
[HEALTH] Attempting recovery for BINANCE:BTCUSDT/1 (attempt 1/3)
[HEALTH] Successfully resubscribed to BINANCE:BTCUSDT/1
```

For severe issues, more aggressive recovery actions are logged:

```
[HEALTH] 4 stale subscriptions exceeds threshold (3), performing full reconnect
[HEALTH] Performing full TradingView reconnect due to multiple stale subscriptions
[HEALTH] Full TradingView reconnect successful
```

### Health Monitoring Metrics

The following Prometheus metrics are exposed for monitoring the health of TradingView data flow:

- `stale_subscriptions`: Gauge of currently stale subscriptions
- `recovery_attempts_total`: Counter of recovery attempts
- `successful_recoveries_total`: Counter of successful recovery attempts
- `failed_recoveries_total`: Counter of failed recovery attempts
- `full_reconnects_total`: Counter of full TradingView reconnections
- `last_data_received_seconds`: Gauge of seconds since last data per subscription (labeled by symbol and timeframe)

These metrics can be used to set up alerts for persistent data flow issues.

## WebSocket API

The service provides a WebSocket API for managing subscriptions and receiving real-time data.

### Message Format

#### Requests (client → server)

```json
{
  "action": "subscribe", // or unsubscribe, list, subscribe_many, unsubscribe_many
  "symbol": "BINANCE:BTCUSDT", // for subscribe/unsubscribe
  "timeframe": "1",           // for subscribe/unsubscribe
  "pairs": [                   // for subscribe_many/unsubscribe_many
    { "symbol": "BINANCE:BTCUSDT", "timeframe": "1" },
    { "symbol": "BINANCE:ETHUSDT", "timeframe": "5" }
  ],
  "requestId": "optional-string-id"
}
```

#### Responses (server → client)

```json
{
  "type": "subscribe", // or unsubscribe, list, bar, error, info, subscribe_many, unsubscribe_many
  "success": true,
  "message": "Subscription created",
  "requestId": "optional-string-id",
  "symbol": "BINANCE:BTCUSDT",
  "timeframe": "1",
  "subscriptions": [ { "symbol": "BINANCE:BTCUSDT", "timeframe": "1" } ], // for list and bulk
  "bar": { /* ... */ }, // for type: bar
  "results": [ /* ... */ ] // for bulk operations
}
```

#### Example Requests

- **Subscribe to a single instrument:**
```json
{
  "action": "subscribe",
  "symbol": "BINANCE:BTCUSDT",
  "timeframe": "1",
  "requestId": "sub-1"
}
```
- **Unsubscribe:**
```json
{
  "action": "unsubscribe",
  "symbol": "BINANCE:BTCUSDT",
  "timeframe": "1",
  "requestId": "unsub-1"
}
```
- **Get subscription list:**
```json
{
  "action": "list",
  "requestId": "list-1"
}
```
- **Bulk subscribe:**
```json
{
  "action": "subscribe_many",
  "pairs": [
    { "symbol": "BINANCE:BTCUSDT", "timeframe": "1" },
    { "symbol": "BINANCE:ETHUSDT", "timeframe": "5" }
  ],
  "requestId": "bulk-sub-1"
}
```
- **Bulk unsubscribe:**
```json
{
  "action": "unsubscribe_many",
  "pairs": [
    { "symbol": "BINANCE:BTCUSDT", "timeframe": "1" },
    { "symbol": "BINANCE:ETHUSDT", "timeframe": "5" }
  ],
  "requestId": "bulk-unsub-1"
}
```

#### Example Responses

- **Successful subscription:**
```json
{
  "type": "subscribe",
  "success": true,
  "message": "Subscription created",
  "symbol": "BINANCE:BTCUSDT",
  "timeframe": "1",
  "requestId": "sub-1"
}
```
- **Bulk subscribe:**
```json
{
  "type": "subscribe_many",
  "success": true,
  "message": "Bulk subscribe processed",
  "subscriptions": [
    { "symbol": "BINANCE:BTCUSDT", "timeframe": "1" },
    { "symbol": "BINANCE:ETHUSDT", "timeframe": "5" }
  ],
  "results": [
    { "symbol": "BINANCE:BTCUSDT", "timeframe": "1", "success": true, "message": "Subscription created" },
    { "symbol": "BINANCE:ETHUSDT", "timeframe": "5", "success": true, "message": "Subscription created" }
  ],
  "requestId": "bulk-sub-1"
}
```
- **Error:**
```json
{
  "type": "error",
  "success": false,
  "message": "Symbol and timeframe are required for subscription",
  "requestId": "sub-err-1"
}
```