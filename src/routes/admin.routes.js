import express from 'express';
import { validateApiKey, requireAdmin } from '../middleware/auth.js';
import {
  getSystemStats,
  getRecentLogs,
  getAdminLogs
} from '../controllers/admin.controller.js';

const router = express.Router();

router.use(validateApiKey);
// router.use(requireAdmin); // Uncomment when admin auth is fully implemented

// 시스템 통계
router.get('/stats', getSystemStats);

// 로그 조회
router.get('/logs/system', getRecentLogs);
router.get('/logs/admin', getAdminLogs);

export default router;
