# 🔗 Discord 봇 연동 가이드

이 가이드는 4개의 Discord 봇을 TACO Backend API에 연동하는 방법을 설명합니다.

## 목차

1. [taco-auth 연동](#1-taco-auth-연동)
2. [taco-task 연동](#2-taco-task-연동)
3. [taco-game 연동](#3-taco-game-연동)
4. [taco-reward 연동](#4-taco-reward-연동)

---

## 공통 설정

모든 봇의 `.env` 파일에 다음 추가:

```env
TACO_BACKEND_URL=http://localhost:5000
TACO_BACKEND_API_KEY=your_secret_key_from_backend
```

### API 호출 헬퍼 함수

모든 봇에서 사용할 공통 헬퍼 함수:

```javascript
// utils/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.TACO_BACKEND_URL + '/api/v1',
  headers: {
    'x-api-key': process.env.TACO_BACKEND_API_KEY,
    'Content-Type': 'application/json'
  }
});

export default api;
```

---

## 1. taco-auth 연동

### 변경 사항

#### `index.js` - TikTok 인증 완료 후

```javascript
import api from './utils/api.js';

// TikTok OAuth 콜백 처리 후
async function handleTikTokCallback(userId, tiktokData) {
  try {
    // 백엔드에 사용자 정보 저장
    const response = await api.post('/users', {
      userId: userId,
      discordUsername: interaction.user.username,
      discordDiscriminator: interaction.user.discriminator,
      tiktokOpenId: tiktokData.open_id,
      tiktokUnionId: tiktokData.union_id,
      tiktokUsername: tiktokData.username,
      tiktokDisplayName: tiktokData.display_name,
      tiktokAvatarUrl: tiktokData.avatar_url,
      tiktokFollowersCount: tiktokData.follower_count,
      tiktokFollowingCount: tiktokData.following_count,
      region: null, // 나중에 설정
      email: null
    });

    console.log('User created/updated in backend:', response.data);

    // Discord 역할 부여
    await assignDiscordRole(userId, 'tiktok-authorized');

  } catch (error) {
    console.error('Failed to sync user with backend:', error);
  }
}
```

#### 카테고리 선택 처리

```javascript
// 사용자가 카테고리 선택 시 (reaction role 또는 button)
async function updateUserCategories(userId, categories) {
  try {
    await api.put(`/users/${userId}/categories`, {
      categories: categories // ["beauty", "tech", "food"]
    });

    console.log('Categories updated in backend');
  } catch (error) {
    console.error('Failed to update categories:', error);
  }
}
```

#### 지역 변경 처리

```javascript
// /region 명령어 처리
async function handleRegionCommand(interaction, region) {
  try {
    await api.put(`/users/${interaction.user.id}/region`, {
      region: region
    });

    await interaction.reply(`✅ Region updated to ${region}`);

  } catch (error) {
    if (error.response?.status === 429) {
      // 60일 쿨다운
      await interaction.reply(`⏰ ${error.response.data.error}`);
    } else {
      await interaction.reply('❌ Failed to update region');
    }
  }
}
```

---

## 2. taco-task 연동

### 변경 사항

#### `src/index.js` - 태스크 할당

기존 로컬 JSON 파일 대신 백엔드 API 사용:

```javascript
import api from './utils/api.js';

async function handleTaskAssignment(interaction) {
  const userId = interaction.user.id;

  try {
    // 백엔드에서 태스크 할당
    const response = await api.post('/tasks/assign', {
      userId: userId,
      count: 10 // 또는 랜덤 10-15
    });

    const { sessionId, tasks, expiredAt } = response.data.data;

    // DM으로 태스크 전송
    const dmEmbed = {
      title: '📋 Your Tasks',
      description: `You have ${tasks.length} tasks. Complete them before <t:${Math.floor(new Date(expiredAt).getTime() / 1000)}:R>`,
      fields: tasks.map((task, index) => ({
        name: `${index + 1}. ${task.title}`,
        value: `[Watch Video](${task.video_url})\nCategory: ${task.category}`
      })),
      color: 0x00AE86
    };

    await interaction.user.send({ embeds: [dmEmbed] });
    await interaction.reply({ content: '✅ Tasks sent to your DM!', ephemeral: true });

  } catch (error) {
    if (error.response?.status === 429) {
      await interaction.reply({ content: error.response.data.error, ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ Failed to assign tasks', ephemeral: true });
    }
  }
}
```

#### 태스크 제출 처리

```javascript
// 사용자가 댓글 URL을 DM으로 제출 시
async function handleCommentSubmit(message, taskId, commentUrl) {
  try {
    // 백엔드에 댓글 URL 제출
    await api.post(`/tasks/${taskId}/complete`, {
      commentUrl: commentUrl,
      commentText: null // 필요시 추가
    });

    await message.reply('✅ Comment submitted! We will verify it shortly.');

  } catch (error) {
    await message.reply('❌ Failed to submit comment');
  }
}
```

#### 댓글 검증 (백엔드 크론잡으로 이동)

기존의 댓글 크롤링 코드를 제거하고 백엔드에서 자동 처리합니다.

---

## 3. taco-game 연동

### 변경 사항

#### `src/database.js` 대체

기존 SQLite 대신 백엔드 API 사용:

```javascript
import api from './utils/api.js';

// 예측 게임 생성
export async function createPrediction(data) {
  const response = await api.post('/predictions', {
    videoUrl: data.video_url,
    title: data.title,
    predictionType: data.prediction_type,
    predictionFormat: data.prediction_format,
    targetValue: data.target_value,
    rangeOptions: data.range_options,
    deadline: data.deadline,
    createdBy: data.created_by
  });

  return response.data.data;
}

// 투표 제출
export async function submitVote(predictionId, userId, choice) {
  const response = await api.post(`/predictions/${predictionId}/vote`, {
    userId: userId,
    choice: choice
  });

  return response.data.data;
}

// 예측 정산
export async function settlePrediction(predictionId, actualValue, correctAnswer) {
  const response = await api.post(`/predictions/${predictionId}/settle`, {
    actualValue: actualValue,
    correctAnswer: correctAnswer
  });

  return response.data;
}
```

#### `src/index.js` 수정

```javascript
// 기존 database.js import 제거
// import { createPrediction, submitVote } from './database.js';

// 새로운 API import
import * as predictionAPI from './api/predictions.js';

// 사용
const prediction = await predictionAPI.createPrediction(data);
```

---

## 4. taco-reward 연동

### 변경 사항

#### `src/services/db.js` 대체

기존 SQLite 대신 백엔드 API 사용:

```javascript
import api from './utils/api.js';

// 포인트 조회
export async function getUserBalance(userId) {
  const response = await api.get(`/points/${userId}/balance`);
  return response.data.data.balance;
}

// 포인트 거래 내역
export async function getUserTransactions(userId) {
  const response = await api.get(`/points/${userId}/transactions`);
  return response.data.data;
}

// 바우처 교환 신청
export async function createRedemption(userId, voucherData) {
  const response = await api.post('/redemptions', {
    userId: userId,
    voucherId: voucherData.voucher_id,
    voucherName: voucherData.name,
    amountNacho: voucherData.cost_nacho,
    amountUsd: voucherData.cost_usd
  });

  return response.data.data;
}

// 교환 승인 (어드민)
export async function approveRedemption(redemptionId, adminId, voucherLink) {
  const response = await api.post(`/redemptions/${redemptionId}/approve`, {
    reviewedBy: adminId,
    voucherLink: voucherLink
  });

  return response.data.data;
}

// 교환 거부 (어드민)
export async function denyRedemption(redemptionId, adminId, reason) {
  const response = await api.post(`/redemptions/${redemptionId}/deny`, {
    reviewedBy: adminId,
    reviewNote: reason
  });

  return response.data.data;
}
```

#### `/balance` 명령어 수정

```javascript
import api from './utils/api.js';

async function handleBalanceCommand(interaction) {
  try {
    const response = await api.get(`/points/${interaction.user.id}/balance`);
    const balance = response.data.data.balance;

    await interaction.reply({
      embeds: [{
        title: '💰 Your NACHO Balance',
        description: `You have **${balance} NACHO**\n\n1,000 NACHO = $1 USD`,
        color: 0xFFD700
      }],
      ephemeral: true
    });

  } catch (error) {
    await interaction.reply({ content: '❌ Failed to fetch balance', ephemeral: true });
  }
}
```

---

## 마이그레이션 체크리스트

### taco-auth
- [ ] 백엔드 API 호출 헬퍼 추가
- [ ] TikTok 인증 완료 후 백엔드에 사용자 저장
- [ ] 카테고리 선택 시 백엔드 업데이트
- [ ] 지역 변경 시 백엔드 업데이트 (60일 쿨다운 체크)

### taco-task
- [ ] 태스크 할당 API로 변경
- [ ] 로컬 JSON 파일 제거
- [ ] 댓글 제출 API 연동
- [ ] 로컬 크롤링 코드 제거 (백엔드에서 처리)

### taco-game
- [ ] SQLite 제거
- [ ] 예측 게임 API 연동
- [ ] 투표 API 연동
- [ ] 정산 API 연동

### taco-reward
- [ ] SQLite 제거
- [ ] 포인트 조회 API 연동
- [ ] 바우처 교환 API 연동
- [ ] 승인/거부 API 연동

---

## 테스트

### 1. 백엔드 서버 시작

```bash
cd taco-backend
npm start
```

### 2. 각 봇 테스트

```bash
# taco-auth
cd taco-auth
npm start

# Discord에서 /verify 실행
# 백엔드 로그 확인: "User created/updated: 123456789"
```

```bash
# taco-task
cd taco-task
npm start

# Discord에서 /task 실행
# 백엔드 로그 확인: "Tasks assigned: 123456789, count: 10"
```

### 3. 전체 플로우 테스트

1. `/verify` → TikTok 인증 → 백엔드에 사용자 생성
2. 카테고리 선택 → 백엔드에 카테고리 저장
3. `/task` → 백엔드에서 태스크 할당 (카테고리 매칭)
4. 댓글 작성 → 댓글 URL 제출 → 백엔드에서 검증
5. 1주일 후 → 크론잡이 자동 재검증 → 포인트 자동 지급
6. `/balance` → 백엔드에서 포인트 조회
7. `/redeem` → 백엔드에서 교환 신청 → 포인트 차감
8. 어드민 승인 → Tremendous API 바우처 발급

---

## 문제 해결

### API 호출 실패

```javascript
// 에러 로깅 추가
try {
  const response = await api.post('/users', data);
} catch (error) {
  console.error('API Error:', {
    status: error.response?.status,
    data: error.response?.data,
    message: error.message
  });
}
```

### 환경 변수 확인

```bash
# 각 봇의 .env 파일 확인
cat .env | grep TACO_BACKEND
```

### 백엔드 로그 확인

```bash
cd taco-backend
tail -f logs/combined.log
```

---

## 다음 단계

1. ✅ 백엔드 API 서버 배포 (Railway/Render)
2. ✅ PostgreSQL 데이터베이스 설정
3. ✅ 4개 봇을 백엔드 API에 연동
4. ✅ 전체 플로우 테스트
5. ⏳ 프로덕션 배포

