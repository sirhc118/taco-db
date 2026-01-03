# 🌮 TACO Backend API

중앙 데이터베이스 및 API 서버 - TACO Discord 봇 생태계의 백엔드

## 📋 목차

- [개요](#개요)
- [시스템 아키텍처](#시스템-아키텍처)
- [주요 기능](#주요-기능)
- [설치 방법](#설치-방법)
- [API 문서](#api-문서)
- [크론잡](#크론잡)
- [배포](#배포)

## 개요

TACO Backend는 4개의 Discord 봇(taco-auth, taco-task, taco-game, taco-reward)을 위한 중앙 데이터베이스 및 REST API 서버입니다.

**기술 스택:**
- Node.js 18+
- Express.js 4
- PostgreSQL 14+
- node-cron (스케줄링)
- Cheerio (웹 스크래핑)

## 시스템 아키텍처

```
┌─────────────────┐
│  taco-auth      │ → 사용자 인증 및 프로필 관리
│  (Discord Bot)  │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  taco-backend   │ ← 중앙 PostgreSQL DB
│  (REST API)     │ ← 댓글 크롤링 크론잡
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  taco-task      │ → 태스크 할당 및 관리
│  (Discord Bot)  │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  taco-game      │ → 예측 게임
│  (Discord Bot)  │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  taco-reward    │ → 포인트 및 바우처 교환
│  (Discord Bot)  │
└─────────────────┘
```

## 주요 기능

### 1. 사용자 관리
- TikTok OAuth 인증 정보 저장
- Discord 사용자 프로필 관리
- 카테고리 및 지역 설정 (60일 쿨다운)
- 사용자별 포인트 및 레벨 관리

### 2. 태스크 시스템
- **태스크 할당**: 사용자별 맞춤형 10-15개 할당
- **카테고리 매칭**: 70% 관심사 기반, 30% 랜덤
- **30분 세션 관리**: 만료 자동 처리
- **중복 방지**: 동일 제목 비디오 1개만 할당
- **댓글 검증**: 1주일 후 자동 재확인 및 포인트 지급

### 3. 포인트 시스템
- **적립**: 태스크 완료 시 20 NACHO 자동 지급
- **차감**: 바우처 교환 시 즉시 차감
- **환불**: 교환 거부 시 자동 환불
- **거래 내역**: 모든 포인트 변동 기록

### 4. 크론잡
- **댓글 재검증**: 6시간마다 실행
- **메트릭 업데이트**: 매일 새벽 2시
- **태스크 정리**: 15분마다 만료된 태스크 정리

## 설치 방법

### 1. 사전 요구사항

- Node.js 18.0 이상
- PostgreSQL 14 이상 (또는 Supabase)
- npm 또는 yarn

### 2. 프로젝트 클론 및 설치

```bash
cd taco-backend
npm install
```

### 3. 데이터베이스 설정

#### Option A: 로컬 PostgreSQL

```bash
# PostgreSQL 설치 (Windows)
# https://www.postgresql.org/download/windows/

# 데이터베이스 생성
psql -U postgres
CREATE DATABASE taco_db;
\q

# 스키마 적용
psql -U postgres -d taco_db -f database/schema.sql
```

#### Option B: Supabase (권장)

1. [Supabase](https://supabase.com/)에서 새 프로젝트 생성
2. SQL Editor에서 `database/schema.sql` 내용 복사 후 실행
3. Settings → Database에서 연결 문자열 복사

### 4. 환경 변수 설정

`.env.example`을 복사하여 `.env` 파일 생성:

```bash
cp .env.example .env
```

필수 환경 변수 입력:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=taco_db
DB_USER=postgres
DB_PASSWORD=your_password

# 또는 Supabase
# DATABASE_URL=postgresql://...

# API Security
API_SECRET_KEY=your_secret_key_here_min_32_chars
JWT_SECRET=your_jwt_secret

# Cron Jobs
ENABLE_CRON=true
```

### 5. 서버 실행

```bash
# 개발 모드 (자동 재시작)
npm run dev

# 프로덕션 모드
npm start
```

서버가 성공적으로 시작되면:
```
🚀 TACO Backend API server running on port 5000
📡 API endpoint: http://localhost:5000/api/v1
🏥 Health check: http://localhost:5000/health
```

### 6. 헬스체크

```bash
curl http://localhost:5000/health
```

## API 문서

### 인증

모든 API 요청은 `x-api-key` 헤더가 필요합니다:

```bash
curl -H "x-api-key: YOUR_API_SECRET_KEY" \
  http://localhost:5000/api/v1/users/123
```

### 주요 엔드포인트

#### 사용자 관리

```
POST   /api/v1/users                    - 사용자 생성/업데이트
GET    /api/v1/users/:userId            - 사용자 조회
PUT    /api/v1/users/:userId            - 사용자 정보 업데이트
PUT    /api/v1/users/:userId/categories - 카테고리 업데이트
PUT    /api/v1/users/:userId/region     - 지역 변경
GET    /api/v1/users/:userId/stats      - 사용자 통계
```

#### 태스크 관리

```
POST   /api/v1/tasks/assign            - 태스크 할당 (10-15개)
GET    /api/v1/tasks/user/:userId      - 사용자 태스크 목록
GET    /api/v1/tasks/:taskId           - 개별 태스크 조회
POST   /api/v1/tasks/:taskId/complete  - 태스크 완료 (댓글 URL 제출)
POST   /api/v1/tasks/:taskId/verify    - 댓글 검증
POST   /api/v1/tasks/:taskId/recheck   - 1주일 후 재검증
```

#### 포인트 관리

```
GET    /api/v1/points/:userId/balance      - 포인트 잔액 조회
GET    /api/v1/points/:userId/transactions - 거래 내역
POST   /api/v1/points/grant                - 포인트 지급
POST   /api/v1/points/deduct               - 포인트 차감
```

#### 바우처 교환

```
POST   /api/v1/redemptions                     - 교환 신청
GET    /api/v1/redemptions/:redemptionId       - 교환 조회
GET    /api/v1/redemptions/user/:userId        - 사용자 교환 내역
GET    /api/v1/redemptions/status/pending      - 대기 중인 교환
POST   /api/v1/redemptions/:redemptionId/approve - 승인
POST   /api/v1/redemptions/:redemptionId/deny    - 거부
POST   /api/v1/redemptions/:redemptionId/cancel  - 취소
```

#### 캠페인 관리

```
POST   /api/v1/campaigns                        - 캠페인 생성
GET    /api/v1/campaigns                        - 캠페인 목록
GET    /api/v1/campaigns/:campaignId            - 캠페인 조회
PUT    /api/v1/campaigns/:campaignId            - 캠페인 상태 업데이트
POST   /api/v1/campaigns/:campaignId/videos     - 비디오 추가
POST   /api/v1/campaigns/videos/:videoId/metrics - 메트릭 업데이트
```

#### 예측 게임

```
POST   /api/v1/predictions                     - 예측 게임 생성
GET    /api/v1/predictions/:predictionId       - 예측 조회
GET    /api/v1/predictions/status/active       - 활성 예측 목록
POST   /api/v1/predictions/:predictionId/vote  - 투표
POST   /api/v1/predictions/:predictionId/settle - 정산
```

### API 요청 예시

#### 1. 사용자 생성 (taco-auth에서 호출)

```javascript
const response = await fetch('http://localhost:5000/api/v1/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.API_SECRET_KEY
  },
  body: JSON.stringify({
    userId: '123456789',
    discordUsername: 'user#1234',
    tiktokOpenId: 'abc123',
    tiktokUsername: 'tiktoker',
    region: 'KR'
  })
});
```

#### 2. 태스크 할당 (taco-task에서 호출)

```javascript
const response = await fetch('http://localhost:5000/api/v1/tasks/assign', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.API_SECRET_KEY
  },
  body: JSON.stringify({
    userId: '123456789',
    count: 10
  })
});

// 응답:
{
  "success": true,
  "data": {
    "sessionId": "session-uuid",
    "tasks": [
      {
        "task_id": "task-uuid",
        "video_url": "https://tiktok.com/@user/video/123",
        "title": "Video Title",
        "category": "beauty"
      }
      // ... 9개 더
    ],
    "expiredAt": "2025-01-01T12:30:00Z"
  }
}
```

#### 3. 댓글 제출 및 검증

```javascript
// Step 1: 사용자가 댓글 작성 후 URL 제출
await fetch(`http://localhost:5000/api/v1/tasks/${taskId}/complete`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.API_SECRET_KEY
  },
  body: JSON.stringify({
    commentUrl: 'https://tiktok.com/@user/video/123?comment_id=456',
    commentText: 'Great video!'
  })
});

// Step 2: 백엔드 크롤링 후 검증
await fetch(`http://localhost:5000/api/v1/tasks/${taskId}/verify`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.API_SECRET_KEY
  },
  body: JSON.stringify({
    commentId: '456',
    isVerified: true
  })
});

// → 1주일 후 크론잡이 자동으로 재검증하여 포인트 지급
```

## 크론잡

백엔드는 3개의 크론잡을 자동으로 실행합니다.

### 1. 댓글 재검증 (6시간마다)

```javascript
// src/cron/recheckComments.js
```

- 1주일 지난 태스크의 댓글을 재확인
- 댓글이 유지되면 20 NACHO 자동 지급
- 댓글이 삭제되면 포인트 지급 없음

### 2. 비디오 메트릭 업데이트 (매일 새벽 2시)

```javascript
// src/cron/updateMetrics.js
```

- 활성 캠페인의 모든 비디오 메트릭 크롤링
- 조회수, 좋아요, 댓글, 공유수 업데이트

### 3. 만료된 태스크 정리 (15분마다)

```javascript
// src/cron/cleanupTasks.js
```

- 30분 지난 미완료 태스크를 `expired` 상태로 변경
- 60일 이상 된 할당 트래커 삭제

### 크론잡 비활성화

```env
ENABLE_CRON=false
```

## 배포

### Railway 배포

1. Railway 계정 생성: https://railway.app/
2. PostgreSQL 플러그인 추가
3. 새 서비스 생성 및 GitHub 연결
4. 환경 변수 설정:

```
DB_HOST=${{Postgres.PGHOST}}
DB_PORT=${{Postgres.PGPORT}}
DB_NAME=${{Postgres.PGDATABASE}}
DB_USER=${{Postgres.PGUSER}}
DB_PASSWORD=${{Postgres.PGPASSWORD}}
API_SECRET_KEY=your_secret_key
ENABLE_CRON=true
```

5. 배포 후 SQL 탭에서 `database/schema.sql` 실행

### Render 배포

1. Render 계정 생성: https://render.com/
2. PostgreSQL 데이터베이스 생성
3. Web Service 생성
4. 환경 변수 설정 및 배포

## Discord 봇 연동

각 Discord 봇의 `.env`에 백엔드 URL 추가:

```env
# taco-auth/.env
TACO_BACKEND_URL=https://your-backend.railway.app
TACO_BACKEND_API_KEY=your_secret_key

# taco-task/.env
TACO_BACKEND_URL=https://your-backend.railway.app
TACO_BACKEND_API_KEY=your_secret_key

# taco-game/.env
TACO_BACKEND_URL=https://your-backend.railway.app
TACO_BACKEND_API_KEY=your_secret_key

# taco-reward/.env
TACO_BACKEND_URL=https://your-backend.railway.app
TACO_BACKEND_API_KEY=your_secret_key
```

## 데이터 플로우

### 전체 사용자 여정

1. **사용자 가입** (taco-auth)
   - TikTok OAuth 인증
   - 사용자 정보 백엔드에 저장
   - Discord 역할 부여

2. **카테고리 선택** (taco-auth)
   - 사용자가 관심 카테고리 선택
   - 백엔드에 카테고리 저장

3. **태스크 할당** (taco-task)
   - 사용자가 `/task` 명령어 실행
   - 백엔드가 카테고리 매칭하여 10-15개 할당
   - 30분 세션 시작

4. **태스크 완료** (사용자)
   - TikTok 영상 시청 및 댓글 작성
   - 댓글 URL을 봇에 제출
   - 백엔드가 댓글 크롤링 및 검증

5. **1주일 후 재검증** (크론잡)
   - 백엔드가 자동으로 댓글 재확인
   - 댓글 유지 시 20 NACHO 자동 지급
   - 포인트 거래 기록 저장

6. **바우처 교환** (taco-reward)
   - 사용자가 `/redeem` 명령어 실행
   - 포인트 즉시 차감
   - 어드민 승인 시 Tremendous API로 바우처 발급
   - 거부 시 포인트 자동 환불

## 문제 해결

### 데이터베이스 연결 실패

```bash
# PostgreSQL 서비스 상태 확인
sudo systemctl status postgresql

# 연결 테스트
psql -U postgres -d taco_db -c "SELECT NOW();"
```

### 크론잡이 실행되지 않음

```env
# .env 파일 확인
ENABLE_CRON=true

# 로그 확인
tail -f logs/combined.log
```

### TikTok 크롤링 실패

TikTok은 client-side rendering을 사용하므로 Puppeteer/Playwright 사용 권장:

```bash
npm install puppeteer
```

## 라이선스

MIT

## 기여

이슈와 풀 리퀘스트는 언제나 환영합니다!

## 연락처

GitHub Issues: https://github.com/your-repo/taco-backend/issues
