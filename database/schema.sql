-- TACO Backend Database Schema
-- PostgreSQL 14+

-- ============================================
-- 1. 사용자 및 인증 관련 테이블
-- ============================================

-- 사용자 기본 정보
CREATE TABLE users (
    user_id VARCHAR(50) PRIMARY KEY, -- Discord user ID
    discord_username VARCHAR(100) NOT NULL,
    discord_discriminator VARCHAR(10),
    tiktok_open_id VARCHAR(100), -- TikTok OAuth open_id
    tiktok_union_id VARCHAR(100), -- TikTok OAuth union_id
    tiktok_username VARCHAR(100),
    tiktok_display_name VARCHAR(200),
    tiktok_avatar_url TEXT,
    tiktok_followers_count INTEGER DEFAULT 0,
    tiktok_following_count INTEGER DEFAULT 0,
    region VARCHAR(10), -- 지역 코드 (KR, US, JP 등)
    email VARCHAR(255),
    total_points INTEGER DEFAULT 0, -- 총 보유 NACHO 포인트
    level INTEGER DEFAULT 1, -- 사용자 레벨 (1-4)
    total_tasks_completed INTEGER DEFAULT 0, -- 완료한 태스크 수
    is_verified BOOLEAN DEFAULT FALSE, -- TikTok 인증 여부
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP
);

-- 사용자 카테고리 (관심사)
CREATE TABLE user_categories (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL, -- beauty, tech, food, fashion, web3, sports, travel, gaming, music, fitness, pets, dance, finance, automotive, meme
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, category)
);

-- 사용자 지역 변경 이력 (60일 쿨다운 추적)
CREATE TABLE user_region_history (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    old_region VARCHAR(10),
    new_region VARCHAR(10) NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. 캠페인 및 영상 관련 테이블
-- ============================================

-- 캠페인 정보
CREATE TABLE campaigns (
    campaign_id VARCHAR(50) PRIMARY KEY,
    campaign_name VARCHAR(200) NOT NULL,
    category VARCHAR(50) NOT NULL, -- beauty, tech, food 등
    country VARCHAR(10) DEFAULT 'global', -- 타겟 국가 또는 'global'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    target_task_count INTEGER NOT NULL, -- 목표 태스크 수
    status VARCHAR(20) DEFAULT 'active', -- active, paused, completed
    created_by VARCHAR(50), -- 생성한 어드민 user_id
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 캠페인 영상 정보
CREATE TABLE videos (
    video_id VARCHAR(50) PRIMARY KEY,
    campaign_id VARCHAR(50) REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
    platform VARCHAR(20) DEFAULT 'tiktok', -- tiktok, youtube, instagram
    video_url TEXT NOT NULL UNIQUE,
    title VARCHAR(500),
    thumbnail_url TEXT,
    -- 초기 메트릭 (캠페인 시작 시점)
    initial_views INTEGER DEFAULT 0,
    initial_likes INTEGER DEFAULT 0,
    initial_comments INTEGER DEFAULT 0,
    initial_shares INTEGER DEFAULT 0,
    -- 현재 메트릭 (최근 업데이트)
    current_views INTEGER DEFAULT 0,
    current_likes INTEGER DEFAULT 0,
    current_comments INTEGER DEFAULT 0,
    current_shares INTEGER DEFAULT 0,
    metrics_updated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 3. 태스크 관련 테이블
-- ============================================

-- 태스크 할당 세션 (30분 단위)
CREATE TABLE task_sessions (
    session_id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    assigned_count INTEGER DEFAULT 0, -- 할당된 태스크 수 (10-15개)
    completed_count INTEGER DEFAULT 0, -- 완료된 태스크 수
    status VARCHAR(20) DEFAULT 'active', -- active, expired, completed
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP NOT NULL, -- started_at + 30분
    completed_at TIMESTAMP
);

-- 개별 태스크
CREATE TABLE tasks (
    task_id VARCHAR(50) PRIMARY KEY,
    session_id VARCHAR(50) REFERENCES task_sessions(session_id) ON DELETE CASCADE,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    campaign_id VARCHAR(50) REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
    video_id VARCHAR(50) REFERENCES videos(video_id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'assigned', -- assigned, completed, verified, failed, expired
    -- 댓글 정보
    comment_url TEXT, -- 사용자가 남긴 댓글 URL
    comment_id VARCHAR(100), -- TikTok 댓글 ID (크롤링으로 추출)
    comment_text TEXT, -- 댓글 내용
    comment_posted_at TIMESTAMP, -- 댓글 작성 시간
    -- 검증 정보
    first_verified_at TIMESTAMP, -- 최초 댓글 확인 시간
    recheck_scheduled_at TIMESTAMP, -- 1주일 후 재검증 예정 시간
    recheck_verified_at TIMESTAMP, -- 재검증 완료 시간
    is_comment_maintained BOOLEAN, -- 댓글 유지 여부 (1주일 후 확인)
    -- 보상 정보
    points_awarded INTEGER DEFAULT 0, -- 지급된 포인트
    points_awarded_at TIMESTAMP,
    rejection_reason TEXT,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    verified_at TIMESTAMP
);

-- 태스크 할당 제약 추적 (동일 비디오 60분 내 10명 제한)
CREATE TABLE video_assignment_tracker (
    id SERIAL PRIMARY KEY,
    video_id VARCHAR(50) REFERENCES videos(video_id) ON DELETE CASCADE,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_video_time (video_id, assigned_at)
);

-- ============================================
-- 4. 포인트 및 보상 관련 테이블
-- ============================================

-- 포인트 거래 내역
CREATE TABLE point_transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- 양수: 적립, 음수: 차감
    balance_after INTEGER NOT NULL, -- 거래 후 잔액
    transaction_type VARCHAR(50) NOT NULL, -- task_reward, admin_grant, redemption_deduct, redemption_refund, prediction_win
    reference_id VARCHAR(50), -- task_id, redemption_id, prediction_id 등
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(50) -- 어드민이 수동 지급한 경우
);

-- 바우처 교환 신청
CREATE TABLE redemptions (
    redemption_id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    voucher_id VARCHAR(100) NOT NULL, -- Tremendous product ID
    voucher_name VARCHAR(200),
    amount_nacho INTEGER NOT NULL, -- 차감된 NACHO 포인트
    amount_usd DECIMAL(10, 2) NOT NULL, -- USD 금액 (1000 NACHO = $1)
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, denied, cancelled
    -- Tremendous API 응답 정보
    tremendous_order_id VARCHAR(100),
    voucher_link TEXT, -- 바우처 링크 (승인 시 생성)
    -- 검토 정보
    reviewed_by VARCHAR(50), -- 어드민 user_id
    reviewed_at TIMESTAMP,
    review_note TEXT,
    -- 타임스탬프
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP
);

-- ============================================
-- 5. 예측 게임 관련 테이블
-- ============================================

-- 예측 게임
CREATE TABLE predictions (
    prediction_id VARCHAR(50) PRIMARY KEY,
    video_url TEXT NOT NULL,
    title VARCHAR(500),
    thumbnail_url TEXT,
    prediction_type VARCHAR(20) NOT NULL, -- shares, views, likes, comments
    prediction_format VARCHAR(20) NOT NULL, -- simple, range
    -- Simple 형식
    target_value INTEGER, -- 목표값 (Simple 형식)
    -- Range 형식
    range_options JSONB, -- {"low": 50000, "mid": 100000, "high": 200000}
    -- 초기 메트릭
    initial_shares INTEGER DEFAULT 0,
    initial_views INTEGER DEFAULT 0,
    initial_likes INTEGER DEFAULT 0,
    initial_comments INTEGER DEFAULT 0,
    -- 결과
    actual_value INTEGER, -- 실제 결과값
    correct_answer VARCHAR(20), -- yes/no 또는 option_a/option_b/option_c
    -- 상태
    status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, active, closed, settled
    is_weekly_special BOOLEAN DEFAULT FALSE,
    -- 타임스탬프
    deadline TIMESTAMP NOT NULL,
    publish_at TIMESTAMP,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    settled_at TIMESTAMP,
    -- Discord 정보
    message_id VARCHAR(50),
    channel_id VARCHAR(50)
);

-- 사용자 예측 투표
CREATE TABLE user_predictions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    prediction_id VARCHAR(50) REFERENCES predictions(prediction_id) ON DELETE CASCADE,
    choice VARCHAR(20) NOT NULL, -- yes, no, option_a, option_b, option_c
    is_correct BOOLEAN,
    points_awarded INTEGER DEFAULT 0,
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, prediction_id)
);

-- ============================================
-- 6. 크론잡 스케줄링 테이블
-- ============================================

-- 댓글 재검증 스케줄
CREATE TABLE comment_verification_queue (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(50) REFERENCES tasks(task_id) ON DELETE CASCADE,
    video_url TEXT NOT NULL,
    comment_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP NOT NULL, -- 1주일 후
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 7. 어드민 및 로그 테이블
-- ============================================

-- 관리자 활동 로그
CREATE TABLE admin_logs (
    log_id SERIAL PRIMARY KEY,
    admin_id VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL, -- grant_points, approve_redemption, deny_redemption, create_campaign, etc.
    target_user_id VARCHAR(50),
    reference_id VARCHAR(50), -- campaign_id, redemption_id 등
    details JSONB, -- 추가 정보
    ip_address VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 시스템 로그
CREATE TABLE system_logs (
    log_id SERIAL PRIMARY KEY,
    level VARCHAR(20) NOT NULL, -- info, warning, error, critical
    service VARCHAR(50) NOT NULL, -- taco-auth, taco-task, taco-game, taco-reward, taco-backend
    message TEXT NOT NULL,
    stack_trace TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 인덱스 생성
-- ============================================

-- 사용자 조회 최적화
CREATE INDEX idx_users_discord_id ON users(user_id);
CREATE INDEX idx_users_tiktok_open_id ON users(tiktok_open_id);
CREATE INDEX idx_users_region ON users(region);
CREATE INDEX idx_users_active ON users(is_active);

-- 태스크 조회 최적화
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_session_id ON tasks(session_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_recheck_scheduled ON tasks(recheck_scheduled_at) WHERE recheck_scheduled_at IS NOT NULL;

-- 포인트 거래 내역
CREATE INDEX idx_transactions_user_id ON point_transactions(user_id, created_at DESC);
CREATE INDEX idx_transactions_type ON point_transactions(transaction_type);

-- 바우처 교환
CREATE INDEX idx_redemptions_user_id ON redemptions(user_id);
CREATE INDEX idx_redemptions_status ON redemptions(status);

-- 캠페인 및 영상
CREATE INDEX idx_videos_campaign_id ON videos(campaign_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);

-- 예측 게임
CREATE INDEX idx_predictions_status ON predictions(status);
CREATE INDEX idx_predictions_deadline ON predictions(deadline);

-- 댓글 검증 큐
CREATE INDEX idx_verification_queue_scheduled ON comment_verification_queue(scheduled_at, status);

-- ============================================
-- 트리거 함수
-- ============================================

-- updated_at 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- users 테이블 트리거
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- campaigns 테이블 트리거
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 초기 데이터 (선택사항)
-- ============================================

-- 지원 카테고리 (참고용, 실제로는 애플리케이션에서 관리)
-- Beauty, Tech, Food, Fashion, Web3, Sports, Travel, Gaming, Music, Fitness, Pets, Dance, Finance, Automotive, Meme

COMMENT ON TABLE users IS '사용자 기본 정보 및 TikTok 인증 정보';
COMMENT ON TABLE user_categories IS '사용자가 선택한 관심 카테고리';
COMMENT ON TABLE campaigns IS '마케팅 캠페인 정보';
COMMENT ON TABLE videos IS '캠페인별 TikTok/YouTube 영상 정보';
COMMENT ON TABLE tasks IS '사용자에게 할당된 개별 태스크';
COMMENT ON TABLE task_sessions IS '30분 단위 태스크 할당 세션';
COMMENT ON TABLE point_transactions IS '포인트 적립/차감 거래 내역';
COMMENT ON TABLE redemptions IS '바우처 교환 신청 및 승인 내역';
COMMENT ON TABLE predictions IS '예측 게임 정보';
COMMENT ON TABLE comment_verification_queue IS '1주일 후 댓글 재검증 스케줄';
