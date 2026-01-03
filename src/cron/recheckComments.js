import { query, transaction } from '../config/database.js';
import { scrapeCommentFromUrl } from '../utils/tiktokScraper.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

// 1주일 지난 댓글 재검증 및 포인트 지급
export async function recheckComments() {
  try {
    // 재검증 대기 중인 태스크 조회
    const pendingTasks = await query(
      `SELECT
        cvq.id as queue_id,
        cvq.task_id,
        cvq.video_url,
        cvq.comment_id,
        cvq.user_id,
        t.comment_url
      FROM comment_verification_queue cvq
      JOIN tasks t ON cvq.task_id = t.task_id
      WHERE cvq.status = 'pending'
      AND cvq.scheduled_at <= NOW()
      ORDER BY cvq.scheduled_at ASC
      LIMIT 50` // 한 번에 50개씩 처리
    );

    if (pendingTasks.rows.length === 0) {
      logger.info('No pending comment rechecks');
      return;
    }

    logger.info(`Processing ${pendingTasks.rows.length} comment rechecks`);

    let successCount = 0;
    let failCount = 0;

    for (const task of pendingTasks.rows) {
      try {
        // 큐 상태를 processing으로 업데이트
        await query(
          `UPDATE comment_verification_queue
           SET status = 'processing'
           WHERE id = $1`,
          [task.queue_id]
        );

        // 댓글 크롤링
        const commentResult = await scrapeCommentFromUrl(task.comment_url);

        const commentMaintained = commentResult.success && commentResult.exists;

        // 태스크 재검증 처리
        await transaction(async (client) => {
          if (commentMaintained) {
            // 댓글 유지 확인됨 - 포인트 지급
            const POINTS_PER_TASK = 20;

            await client.query(
              `UPDATE tasks
               SET
                 is_comment_maintained = true,
                 recheck_verified_at = CURRENT_TIMESTAMP,
                 points_awarded = $1,
                 points_awarded_at = CURRENT_TIMESTAMP
               WHERE task_id = $2`,
              [POINTS_PER_TASK, task.task_id]
            );

            // 사용자 포인트 업데이트
            const userResult = await client.query(
              `UPDATE users
               SET
                 total_points = total_points + $1,
                 total_tasks_completed = total_tasks_completed + 1
               WHERE user_id = $2
               RETURNING total_points`,
              [POINTS_PER_TASK, task.user_id]
            );

            const newBalance = userResult.rows[0].total_points;

            // 포인트 거래 기록
            const transactionId = uuidv4();
            await client.query(
              `INSERT INTO point_transactions (
                transaction_id, user_id, amount, balance_after,
                transaction_type, reference_id, reason
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                transactionId,
                task.user_id,
                POINTS_PER_TASK,
                newBalance,
                'task_reward',
                task.task_id,
                'Task completed and comment maintained for 7 days'
              ]
            );

            logger.info(`Points awarded: ${task.user_id}, task: ${task.task_id}, amount: ${POINTS_PER_TASK}`);
          } else {
            // 댓글 삭제됨 - 포인트 지급 없음
            await client.query(
              `UPDATE tasks
               SET
                 is_comment_maintained = false,
                 recheck_verified_at = CURRENT_TIMESTAMP
               WHERE task_id = $1`,
              [task.task_id]
            );

            logger.warn(`Comment deleted: task ${task.task_id}`);
          }

          // 검증 큐에서 완료 처리
          await client.query(
            `UPDATE comment_verification_queue
             SET
               status = 'completed',
               processed_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [task.queue_id]
          );
        });

        successCount++;

        // Rate limiting을 위한 지연 (1초)
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        logger.error(`Error rechecking comment ${task.task_id}: ${error.message}`);

        // 에러 기록 및 재시도 카운트 증가
        await query(
          `UPDATE comment_verification_queue
           SET
             status = 'pending',
             retry_count = retry_count + 1,
             last_error = $1
           WHERE id = $2`,
          [error.message, task.queue_id]
        );

        failCount++;

        // 재시도 횟수 초과 시 실패 처리
        if (task.retry_count >= 3) {
          await query(
            `UPDATE comment_verification_queue
             SET status = 'failed'
             WHERE id = $1`,
            [task.queue_id]
          );
        }
      }
    }

    logger.info(`Comment recheck completed: ${successCount} succeeded, ${failCount} failed`);

  } catch (error) {
    logger.error(`Comment recheck job error: ${error.message}`);
    throw error;
  }
}

export default recheckComments;
