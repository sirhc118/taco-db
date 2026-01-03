import express from 'express';
import { validateApiKey } from '../middleware/auth.js';
import {
  createUser,
  getUser,
  updateUser,
  updateUserCategories,
  updateUserRegion,
  getUserStats
} from '../controllers/user.controller.js';

const router = express.Router();

// 모든 라우트에 API 키 검증 적용
router.use(validateApiKey);

// 사용자 CRUD
router.post('/', createUser); // Discord 봇이 새 사용자 생성
router.get('/:userId', getUser); // 사용자 정보 조회
router.put('/:userId', updateUser); // 사용자 정보 업데이트
router.get('/:userId/stats', getUserStats); // 사용자 통계

// 사용자 프로필 관리
router.put('/:userId/categories', updateUserCategories); // 카테고리 업데이트
router.put('/:userId/region', updateUserRegion); // 지역 변경 (60일 쿨다운 체크)

export default router;
