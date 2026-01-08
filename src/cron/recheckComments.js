import { query, transaction } from '../config/database.js';
import { scrapeAllComments } from '../utils/tiktokScraper.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * 매일 UTC 06:00에 실행되는 댓글 수집 및 검증 크론잡
 *
 * 워크플로우:
 * 1. 활성 캠페인의 모든 영상 조회
 * 2. 각 영상의 댓글 수집 (TikTok 크롤링)
 * 3. 오늘 스냅샷 저장
 * 4. 7일 전 스냅샷과 비교
 * 5. 유지된 댓글에 포인트 지급
 */
export async function collectAndVerifyComments() {
  try {
    logger.info('🕐 Starting daily comment collection and verification job (UTC 06:00)');

    // 1. 활성 캠페인의 영상 목록 조회
    const videosResult = await query(
      `SELECT DISTINCT v.video_id, v.video_url, v.campaign_id
       FROM videos v
       JOIN campaigns c ON v.campaign_id = c.campaign_id
       WHERE c.status = 'active'
       AND c.end_date >= CURRENT_DATE
       ORDER BY v.video_id`
    );

    if (videosResult.rows.length === 0) {
      logger.info('No active videos to process');
      return;
    }

    logger.info(`Processing ${videosResult.rows.length} active videos`);

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let successCount = 0;
    let failCount = 0;
    let pointsAwarded = 0;

    for (const video of videosResult.rows) {
      try {
        logger.info(`Processing video: ${video.video_id}`);

        // 2. 댓글 수집
        const commentsData = await scrapeAllComments(video.video_url);

        if (!commentsData.success) {
          logger.error(`Failed to scrape comments for video ${video.video_id}: ${commentsData.error}`);

          // 실패한 경우에도 스냅샷 기록 (상태: failed)
          await query(
            `INSERT INTO video_comment_snapshots (video_id, video_url, snapshot_date, comment_count, status, error_message)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (video_id, snapshot_date) DO UPDATE
             SET status = $5, error_message = $6, collected_at = CURRENT_TIMESTAMP`,
            [video.video_id, video.video_url, today, 0, 'failed', commentsData.error]
          );

          failCount++;
          continue;
        }

        // 3. 오늘 스냅샷 저장
        await query(
          `INSERT INTO video_comment_snapshots (video_id, video_url, snapshot_date, comment_count, comments, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (video_id, snapshot_date) DO UPDATE
           SET comment_count = $4, comments = $5, status = $6, collected_at = CURRENT_TIMESTAMP`,
          [
            video.video_id,
            video.video_url,
            today,
            commentsData.comment_count,
            JSON.stringify(commentsData.comments),
            'completed'
          ]
        );

        logger.info(`Saved snapshot for video ${video.video_id}: ${commentsData.comment_count} comments`);

        // 4. 오늘 수집된 새 댓글 처리 - comment_verifications에 추가
        await processNewComments(video.video_id, today, commentsData.comments);

        // 5. 7일 전 스냅샷과 비교하여 검증
        const sevenDaysAgoSnapshot = await query(
          `SELECT comments FROM video_comment_snapshots
           WHERE video_id = $1 AND snapshot_date = $2 AND status = 'completed'`,
          [video.video_id, sevenDaysAgo]
        );

        if (sevenDaysAgoSnapshot.rows.length > 0) {
          // 7일 전 댓글과 오늘 댓글 비교
          const awarded = await verifyAndAwardPoints(
            video.video_id,
            sevenDaysAgo,
            sevenDaysAgoSnapshot.rows[0].comments,
            commentsData.comments
          );

          pointsAwarded += awarded;
          logger.info(`Verified comments for video ${video.video_id}: ${awarded} points awarded`);
        }

        successCount++;

        // Rate limiting (2초 대기)
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        logger.error(`Error processing video ${video.video_id}: ${error.message}`);
        failCount++;
      }
    }

    logger.info(`✅ Comment collection completed: ${successCount} succeeded, ${failCount} failed, ${pointsAwarded} NACHO awarded`);

  } catch (error) {
    logger.error(`Comment collection job error: ${error.message}`);
    throw error;
  }
}

/**
 * 새로 수집된 댓글을 comment_verifications 테이블에 추가
 */
async function processNewComments(videoId, snapshotDate, comments) {
  try {
    if (!comments || comments.length === 0) return;

    // 각 댓글에 대해 comment_verifications 레코드 생성
    for (const comment of comments) {
      // 해당 댓글이 어떤 태스크와 연결되는지 확인
      const taskResult = await query(
        `SELECT t.task_id, t.user_id
         FROM tasks t
         WHERE t.video_id = $1
         AND t.comment_id = $2
         AND t.status IN ('completed', 'verified')
         LIMIT 1`,
        [videoId, comment.comment_id]
      );

      if (taskResult.rows.length === 0) {
        // 태스크와 연결되지 않은 댓글은 건너뜀
        continue;
      }

      const task = taskResult.rows[0];
      const verificationDate = new Date(new Date(snapshotDate).getTime() + 7 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

      // comment_verifications에 추가 (중복 방지)
      await query(
        `INSERT INTO comment_verifications (
          task_id, user_id, video_id, comment_id, comment_text,
          comment_posted_date, verification_date, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (task_id, comment_id) DO NOTHING`,
        [
          task.task_id,
          task.user_id,
          videoId,
          comment.comment_id,
          comment.text,
          snapshotDate,
          verificationDate,
          'pending'
        ]
      );
    }

    logger.debug(`Processed ${comments.length} new comments for video ${videoId}`);

  } catch (error) {
    logger.error(`Error processing new comments: ${error.message}`);
    throw error;
  }
}

/**
 * 7일 전 댓글과 오늘 댓글을 비교하여 유지된 댓글에 포인트 지급
 */
async function verifyAndAwardPoints(videoId, commentPostedDate, oldComments, newComments) {
  try {
    const oldCommentIds = new Set(oldComments.map(c => c.comment_id));
    const newCommentIds = new Set(newComments.map(c => c.comment_id));

    // 유지된 댓글 ID 찾기
    const maintainedCommentIds = [...oldCommentIds].filter(id => newCommentIds.has(id));

    if (maintainedCommentIds.length === 0) {
      logger.info(`No maintained comments for video ${videoId} from ${commentPostedDate}`);
      return 0;
    }

    logger.info(`Found ${maintainedCommentIds.length} maintained comments for video ${videoId}`);

    // 유지된 댓글에 대해 포인트 지급
    let totalPointsAwarded = 0;
    const POINTS_PER_COMMENT = 20;

    for (const commentId of maintainedCommentIds) {
      try {
        // comment_verifications에서 pending 상태인 레코드 조회
        const verificationResult = await query(
          `SELECT id, task_id, user_id
           FROM comment_verifications
           WHERE video_id = $1
           AND comment_id = $2
           AND comment_posted_date = $3
           AND status = 'pending'
           AND verification_date = CURRENT_DATE
           LIMIT 1`,
          [videoId, commentId, commentPostedDate]
        );

        if (verificationResult.rows.length === 0) {
          // 검증 대상이 아니거나 이미 처리됨
          continue;
        }

        const verification = verificationResult.rows[0];

        // 트랜잭션으로 포인트 지급
        await transaction(async (client) => {
          // 1. comment_verifications 업데이트
          await client.query(
            `UPDATE comment_verifications
             SET is_verified = true,
                 is_maintained = true,
                 verified_at = CURRENT_TIMESTAMP,
                 points_awarded = $1,
                 status = 'verified'
             WHERE id = $2`,
            [POINTS_PER_COMMENT, verification.id]
          );

          // 2. tasks 테이블 업데이트
          await client.query(
            `UPDATE tasks
             SET is_comment_maintained = true,
                 recheck_verified_at = CURRENT_TIMESTAMP,
                 points_awarded = $1,
                 points_awarded_at = CURRENT_TIMESTAMP
             WHERE task_id = $2`,
            [POINTS_PER_COMMENT, verification.task_id]
          );

          // 3. 사용자 포인트 업데이트
          const userResult = await client.query(
            `UPDATE users
             SET total_points = total_points + $1,
                 total_tasks_completed = total_tasks_completed + 1
             WHERE user_id = $2
             RETURNING total_points`,
            [POINTS_PER_COMMENT, verification.user_id]
          );

          const newBalance = userResult.rows[0].total_points;

          // 4. 포인트 거래 기록
          const transactionId = uuidv4();
          await client.query(
            `INSERT INTO point_transactions (
              transaction_id, user_id, amount, balance_after,
              transaction_type, reference_id, reason
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              transactionId,
              verification.user_id,
              POINTS_PER_COMMENT,
              newBalance,
              'task_reward',
              verification.task_id,
              `Comment maintained for 7 days (verified on ${new Date().toISOString().split('T')[0]})`
            ]
          );

          logger.info(`✅ Points awarded: ${verification.user_id}, task: ${verification.task_id}, amount: ${POINTS_PER_COMMENT}`);
        });

        totalPointsAwarded += POINTS_PER_COMMENT;

      } catch (error) {
        logger.error(`Error awarding points for comment ${commentId}: ${error.message}`);

        // 에러 발생 시 failed 상태로 업데이트
        await query(
          `UPDATE comment_verifications
           SET status = 'failed',
               verified_at = CURRENT_TIMESTAMP
           WHERE video_id = $1 AND comment_id = $2 AND comment_posted_date = $3`,
          [videoId, commentId, commentPostedDate]
        );
      }
    }

    // 유지되지 않은 댓글 처리 (failed로 표시)
    const deletedCommentIds = [...oldCommentIds].filter(id => !newCommentIds.has(id));
    for (const commentId of deletedCommentIds) {
      await query(
        `UPDATE comment_verifications
         SET is_verified = true,
             is_maintained = false,
             verified_at = CURRENT_TIMESTAMP,
             status = 'failed'
         WHERE video_id = $1
         AND comment_id = $2
         AND comment_posted_date = $3
         AND status = 'pending'`,
        [videoId, commentId, commentPostedDate]
      );

      logger.info(`❌ Comment deleted: ${commentId}, no points awarded`);
    }

    return totalPointsAwarded;

  } catch (error) {
    logger.error(`Error verifying and awarding points: ${error.message}`);
    throw error;
  }
}

export default collectAndVerifyComments;
