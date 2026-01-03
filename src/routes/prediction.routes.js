import express from 'express';
import { validateApiKey } from '../middleware/auth.js';
import {
  createPrediction,
  getPrediction,
  getActivePredictions,
  submitVote,
  settlePrediction,
  getUserPredictions
} from '../controllers/prediction.controller.js';

const router = express.Router();

router.use(validateApiKey);

// 예측 게임 CRUD
router.post('/', createPrediction);
router.get('/:predictionId', getPrediction);
router.get('/status/active', getActivePredictions);
router.get('/user/:userId', getUserPredictions);

// 투표 및 정산
router.post('/:predictionId/vote', submitVote);
router.post('/:predictionId/settle', settlePrediction);

export default router;
