const WebSocket = require('ws');

// Подключение к WebSocket серверу
const ws = new WebSocket('ws://localhost:8081');

// Обработка открытия соединения
ws.on('open', function open() {
  console.log('Connected to TradingView Fetcher WebSocket API');
  
  // Вывести список подписок
  console.log('Запрашиваем список подписок...');
  ws.send(JSON.stringify({
    action: 'list',
    requestId: 'initial-list'
  }));
  
  // Через 3 секунды подписываемся на BINANCE:XRPUSDT
  setTimeout(() => {
    console.log('Подписываемся на BINANCE:XRPUSDT...');
    ws.send(JSON.stringify({
      action: 'subscribe',
      symbol: 'BINANCE:XRPUSDT',
      timeframe: '5', // 5 минут
      requestId: 'sub-xrp'
    }));
  }, 3000);
  
  // Через 10 секунд отписываемся от BINANCE:XRPUSDT
  setTimeout(() => {
    console.log('Отписываемся от BINANCE:XRPUSDT...');
    ws.send(JSON.stringify({
      action: 'unsubscribe',
      symbol: 'BINANCE:XRPUSDT',
      timeframe: '5',
      requestId: 'unsub-xrp'
    }));
  }, 10000);
  
  // Через 15 секунд снова запрашиваем список подписок
  setTimeout(() => {
    console.log('Запрашиваем обновленный список подписок...');
    ws.send(JSON.stringify({
      action: 'list',
      requestId: 'final-list'
    }));
  }, 15000);
});

// Счетчик полученных баров
let barCount = 0;

// Обработка входящих сообщений
ws.on('message', function incoming(data) {
  const message = JSON.parse(data);
  
  if (message.type === 'bar') {
    barCount++;
    console.log(`Получен бар #${barCount}: ${message.bar.symbol}/${message.bar.timeframe} - цена закрытия: ${message.bar.close}`);
    // Ограничиваем количество сообщений
    if (barCount > 15) {
      console.log('Получено достаточно баров, закрываем соединение');
      ws.close();
    }
  } else {
    // Для не-бар сообщений выводим полное содержимое
    console.log('Получено сообщение:', message);
  }
});

// Обработка ошибок
ws.on('error', function error(err) {
  console.error('Ошибка WebSocket:', err);
});

// Обработка закрытия соединения
ws.on('close', function close() {
  console.log('Соединение закрыто');
  process.exit(0);
});

// Обработка выхода по Ctrl+C
process.on('SIGINT', () => {
  console.log('Прерывание, закрываем соединение');
  ws.close();
  process.exit(0);
}); 