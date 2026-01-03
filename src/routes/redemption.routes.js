import express from 'express';
import { validateApiKey } from '../middleware/auth.js';
import {
  createRedemption,
  getRedemption,
  getUserRedemptions,
  getPendingRedemptions,
  approveRedemption,
  denyRedemption,
  cancelRedemption
} from '../controllers/redemption.controller.js';

const router = express.Router();

router.use(validateApiKey);

// 바우처 교환 신청
router.post('/', createRedemption);

// 교환 내역 조회
router.get('/:redemptionId', getRedemption);
router.get('/user/:userId', getUserRedemptions);
router.get('/status/pending', getPendingRedemptions);

// 승인/거부
router.post('/:redemptionId/approve', approveRedemption);
router.post('/:redemptionId/deny', denyRedemption);
router.post('/:redemptionId/cancel', cancelRedemption);

export default router;
