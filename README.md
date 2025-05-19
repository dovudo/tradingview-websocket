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
- **Bar (tick):**
```json
{
  "type": "bar",
  "bar": {
    "symbol": "BINANCE:BTCUSDT",
    "timeframe": "1",
    "time": 1747222140,
    "open": 103905.5,
    "high": 103905.51,
    "low": 103905.5,
    "close": 103905.51,
    "volume": 0.14
  }
}
```

### Backend Integration

To push data to a backend, the bar structure is:

```json
{
  "symbol": "BTCUSDT",
  "time": 1684108800,
  "open": 44000.00,
  "high": 44500.00,
  "low": 43800.00,
  "close": 44250.00,
  "volume": 123.45
}
```

## Prometheus Metrics

The service exports the following metrics on `/metrics`:

- `tv_ws_connects_total` - Number of TradingView connections
- `tv_ws_errors_total` - Number of WebSocket errors
- `tv_bars_pushed_total` - Number of pushed bars
- `tv_http_push_latency_seconds` - HTTP push latency
- `tv_active_subscriptions` - Number of active subscriptions

## Development

```bash
# Run in development mode
npm run dev

# Build
npm run build

# Tests (if any)
npm test
```

## License

MIT

## Notes

- This service uses an unofficial TradingView API library. Use at your own risk.
- For production, it's recommended to use a Docker container with a configured healthcheck.
- All API requests are logged, check LOG_LEVEL settings to reduce message count.

## Example backend request
```json
{
  "symbol": "BTCUSDT",
  "time": 1684108800,
  "open": 44000.00,
  "high": 44500.00,
  "low": 43800.00,
  "close": 44250.00,
  "volume": 123.45
}
```

## Features
- For ESM/TypeScript imports inside source files, use `.js` extensions.
- For dev mode, use `ts-node --esm --experimental-specifier-resolution=node`.
- For production, run only from `dist`.
