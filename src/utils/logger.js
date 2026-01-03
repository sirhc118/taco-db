import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { combine, timestamp, printf, colorize, errors } = winston.format;

// 로그 포맷 정의
const logFormat = printf(({ level, message, timestamp, stack, service }) => {
  return `${timestamp} [${service || 'TACO-BACKEND'}] ${level}: ${stack || message}`;
});

// Winston 로거 생성
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  defaultMeta: { service: 'taco-backend' },
  transports: [
    // Console output
    new winston.transports.Console({
      format: combine(
        colorize(),
        logFormat
      )
    }),
    // File output - errors
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // File output - combined
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// Development 환경에서는 더 상세한 로그
if (process.env.NODE_ENV === 'development') {
  logger.level = 'debug';
}

// 데이터베이스 쿼리 로그
export const logQuery = (query, params, duration) => {
  logger.debug('DB Query', {
    query,
    params,
    duration: `${duration}ms`
  });
};

// 시스템 로그 DB 저장 헬퍼
export const logToDatabase = async (level, service, message, metadata = {}) => {
  try {
    const { query } = await import('../config/database.js');
    await query(
      `INSERT INTO system_logs (level, service, message, metadata)
       VALUES ($1, $2, $3, $4)`,
      [level, service, message, JSON.stringify(metadata)]
    );
  } catch (error) {
    logger.error('Failed to save log to database', { error: error.message });
  }
};

export default logger;
