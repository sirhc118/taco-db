import express from 'express';
import { validateApiKey } from '../middleware/auth.js';
import {
  getUserBalance,
  getUserTransactions,
  grantPoints,
  deductPoints
} from '../controllers/point.controller.js';

const router = express.Router();

// 모든 라우트에 API 키 검증 적용
router.use(validateApiKey);

// 포인트 조회
router.get('/:userId/balance', getUserBalance);
router.get('/:userId/transactions', getUserTransactions);

// 포인트 지급/차감 (어드민 또는 시스템)
router.post('/grant', grantPoints);
router.post('/deduct', deductPoints);

export default router;
