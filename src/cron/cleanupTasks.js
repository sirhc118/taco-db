import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

// 만료된 태스크 정리
export async function cleanupExpiredTasks() {
  try {
    // 30분 지난 세션의 미완료 태스크를 expired 상태로 변경
    const expiredTasks = await query(
      `UPDATE tasks
       SET status = 'expired'
       WHERE status = 'assigned'
       AND session_id IN (
         SELECT session_id
         FROM task_sessions
         WHERE expired_at < NOW()
         AND status = 'active'
       )
       RETURNING task_id`
    );

    if (expiredTasks.rows.length > 0) {
      logger.info(`Marked ${expiredTasks.rows.length} tasks as expired`);
    }

    // 만료된 세션 상태 업데이트
    const expiredSessions = await query(
      `UPDATE task_sessions
       SET status = 'expired'
       WHERE expired_at < NOW()
       AND status = 'active'
       RETURNING session_id`
    );

    if (expiredSessions.rows.length > 0) {
      logger.info(`Marked ${expiredSessions.rows.length} sessions as expired`);
    }

    // 60일 이상 된 할당 트래커 삭제 (성능 최적화)
    const deletedTrackers = await query(
      `DELETE FROM video_assignment_tracker
       WHERE assigned_at < NOW() - INTERVAL '60 days'`
    );

    if (deletedTrackers.rowCount > 0) {
      logger.info(`Deleted ${deletedTrackers.rowCount} old assignment trackers`);
    }

  } catch (error) {
    logger.error(`Task cleanup job error: ${error.message}`);
    throw error;
  }
}

export default cleanupExpiredTasks;
