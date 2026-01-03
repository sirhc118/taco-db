import { logger } from '../utils/logger.js';

// 커스텀 에러 클래스
export class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    Error.captureStackTrace(this, this.constructor);
  }
}

// 에러 핸들러 미들웨어
export const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // 로그 기록
  logger.error(err.message, {
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // PostgreSQL 에러 처리
  if (err.code === '23505') {
    // Unique constraint violation
    error = new AppError('Duplicate field value entered', 400);
  }

  if (err.code === '23503') {
    // Foreign key constraint violation
    error = new AppError('Referenced resource does not exist', 400);
  }

  if (err.code === '22P02') {
    // Invalid input syntax
    error = new AppError('Invalid input format', 400);
  }

  // JWT 에러 처리
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', 401);
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', 401);
  }

  // Validation 에러
  if (err.name === 'ValidationError') {
    error = new AppError('Validation failed', 400);
  }

  // 응답 전송
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// Async 핸들러 래퍼
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default errorHandler;
