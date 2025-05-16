const WebSocket = require('ws');

// Connect to WebSocket server
const ws = new WebSocket('ws://localhost:8081');

// Handle connection open
ws.on('open', function open() {
  console.log('Connected to TradingView Fetcher WebSocket API');
  
  // Request subscription list
  console.log('Requesting subscription list...');
  ws.send(JSON.stringify({
    action: 'list',
    requestId: 'initial-list'
  }));
  
  // After 3 seconds, subscribe to BINANCE:XRPUSDT
  setTimeout(() => {
    console.log('Subscribing to BINANCE:XRPUSDT...');
    ws.send(JSON.stringify({
      action: 'subscribe',
      symbol: 'BINANCE:XRPUSDT',
      timeframe: '5', // 5 minutes
      requestId: 'sub-xrp'
    }));
  }, 3000);
  
  // After 10 seconds, unsubscribe from BINANCE:XRPUSDT
  setTimeout(() => {
    console.log('Unsubscribing from BINANCE:XRPUSDT...');
    ws.send(JSON.stringify({
      action: 'unsubscribe',
      symbol: 'BINANCE:XRPUSDT',
      timeframe: '5',
      requestId: 'unsub-xrp'
    }));
  }, 10000);
  
  // After 15 seconds, request updated subscription list
  setTimeout(() => {
    console.log('Requesting updated subscription list...');
    ws.send(JSON.stringify({
      action: 'list',
      requestId: 'final-list'
    }));
  }, 15000);
});

// Bar counter
let barCount = 0;

// Handle incoming messages
ws.on('message', function incoming(data) {
  const message = JSON.parse(data);
  
  if (message.type === 'bar') {
    barCount++;
    console.log(`Received bar #${barCount}: ${message.bar.symbol}/${message.bar.timeframe} - closing price: ${message.bar.close}`);
    // Limit number of messages
    if (barCount > 15) {
      console.log('Received enough bars, closing connection');
      ws.close();
    }
  } else {
    // For non-bar messages, print full content
    console.log('Received message:', message);
  }
});

// Handle errors
ws.on('error', function error(err) {
  console.error('WebSocket error:', err);
});

// Handle connection close
ws.on('close', function close() {
  console.log('Connection closed');
  process.exit(0);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('Interrupt, closing connection');
  ws.close();
  process.exit(0);
}); 