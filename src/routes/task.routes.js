import express from 'express';
import { validateApiKey } from '../middleware/auth.js';
import {
  assignTasks,
  getTaskSession,
  completeTask,
  verifyTask,
  getTasksForUser,
  getTaskById
} from '../controllers/task.controller.js';

const router = express.Router();

// 모든 라우트에 API 키 검증 적용
router.use(validateApiKey);

// 태스크 할당
router.post('/assign', assignTasks); // taco-task 봇이 호출 (10-15개 할당)

// 태스크 세션 조회
router.get('/session/:sessionId', getTaskSession);

// 사용자의 태스크 목록
router.get('/user/:userId', getTasksForUser);

// 개별 태스크 조회
router.get('/:taskId', getTaskById);

// 태스크 완료 처리 (사용자가 댓글 작성 완료)
router.post('/:taskId/complete', completeTask);

// 태스크 검증 (댓글 크롤링 후 확인)
router.post('/:taskId/verify', verifyTask);

// 주의: 댓글 재검증은 매일 UTC 06:00 크론잡에서 자동으로 처리됩니다.

export default router;
