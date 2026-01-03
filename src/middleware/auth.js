import jwt from 'jsonwebtoken';
import { AppError, asyncHandler } from './errorHandler.js';
import { query } from '../config/database.js';

// API 키 검증 미들웨어 (Discord 봇용)
export const validateApiKey = asyncHandler(async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    throw new AppError('API key is required', 401);
  }

  if (apiKey !== process.env.API_SECRET_KEY) {
    throw new AppError('Invalid API key', 403);
  }

  next();
});

// JWT 토큰 검증 미들웨어 (관리자 대시보드용)
export const verifyToken = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    throw new AppError('Not authorized to access this route', 401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    throw new AppError('Invalid token', 401);
  }
});

// 관리자 권한 확인
export const requireAdmin = asyncHandler(async (req, res, next) => {
  const userId = req.user?.userId || req.headers['x-user-id'];

  if (!userId) {
    throw new AppError('User ID is required', 401);
  }

  // Discord 역할 확인 (실제로는 Discord API 호출 필요)
  // 여기서는 간단히 환경 변수에 있는 어드민 ID 목록과 비교
  const adminIds = process.env.ADMIN_USER_IDS?.split(',') || [];

  if (!adminIds.includes(userId)) {
    throw new AppError('Admin access required', 403);
  }

  next();
});

// 사용자 존재 확인
export const checkUserExists = asyncHandler(async (req, res, next) => {
  const userId = req.params.userId || req.body.userId || req.headers['x-user-id'];

  if (!userId) {
    throw new AppError('User ID is required', 400);
  }

  const result = await query(
    'SELECT user_id FROM users WHERE user_id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  req.userId = userId;
  next();
});

export default {
  validateApiKey,
  verifyToken,
  requireAdmin,
  checkUserExists
};
