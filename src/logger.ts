import winston from 'winston';
import { config } from './config';

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }),
  new winston.transports.File({
    filename: config.log.file,
    level: config.log.level,
    maxsize: 5 * 1024 * 1024, // 5MB
    maxFiles: 5,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  }),
];

export const logger = winston.createLogger({
  level: config.log.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports,
});

let priceLogger = logger;
if (config.debugPrices) {
  priceLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, message }) => `${timestamp} ${message}`)
    ),
    transports: [
      new winston.transports.File({
        filename: config.pricesLogFile,
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5,
      })
    ]
  });
}
export { priceLogger }; 