import express from 'express';
import { validateApiKey } from '../middleware/auth.js';
import {
  createCampaign,
  getCampaign,
  getAllCampaigns,
  updateCampaign,
  addVideoToCampaign,
  updateVideoMetrics
} from '../controllers/campaign.controller.js';

const router = express.Router();

router.use(validateApiKey);

// 캠페인 CRUD
router.post('/', createCampaign);
router.get('/', getAllCampaigns);
router.get('/:campaignId', getCampaign);
router.put('/:campaignId', updateCampaign);

// 영상 관리
router.post('/:campaignId/videos', addVideoToCampaign);
router.post('/videos/:videoId/metrics', updateVideoMetrics);

export default router;
