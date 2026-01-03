import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { recheckComments } from './recheckComments.js';
import { updateVideoMetrics } from './updateMetrics.js';
import { cleanupExpiredTasks } from './cleanupTasks.js';

// 크론잡 시작
export function startCronJobs() {
  if (process.env.ENABLE_CRON !== 'true') {
    logger.info('Cron jobs disabled');
    return;
  }

  logger.info('🕐 Starting cron jobs...');

  // 1. 댓글 재검증 (6시간마다)
  // 1주일 지난 태스크의 댓글을 재확인하여 포인트 지급
  cron.schedule(process.env.COMMENT_RECHECK_CRON || '0 */6 * * *', async () => {
    logger.info('⏰ Running comment recheck job');
    try {
      await recheckComments();
    } catch (error) {
      logger.error(`Comment recheck job failed: ${error.message}`);
    }
  });

  // 2. 비디오 메트릭 업데이트 (매일 새벽 2시)
  cron.schedule(process.env.METRICS_UPDATE_CRON || '0 2 * * *', async () => {
    logger.info('⏰ Running metrics update job');
    try {
      await updateVideoMetrics();
    } catch (error) {
      logger.error(`Metrics update job failed: ${error.message}`);
    }
  });

  // 3. 만료된 태스크 정리 (15분마다)
  cron.schedule(process.env.TASK_CLEANUP_CRON || '*/15 * * * *', async () => {
    logger.info('⏰ Running task cleanup job');
    try {
      await cleanupExpiredTasks();
    } catch (error) {
      logger.error(`Task cleanup job failed: ${error.message}`);
    }
  });

  logger.info('✅ All cron jobs scheduled');
}

export default startCronJobs;
