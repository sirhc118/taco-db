import { query } from '../config/database.js';
import { scrapeVideoMetrics } from '../utils/tiktokScraper.js';
import { logger } from '../utils/logger.js';

// 활성 캠페인의 비디오 메트릭 업데이트
export async function updateVideoMetrics() {
  try {
    // 활성 캠페인의 모든 비디오 조회
    const videos = await query(
      `SELECT DISTINCT v.video_id, v.video_url, v.platform
       FROM videos v
       JOIN campaigns c ON v.campaign_id = c.campaign_id
       WHERE c.status = 'active'
       AND c.end_date >= CURRENT_DATE
       ORDER BY v.video_id`
    );

    if (videos.rows.length === 0) {
      logger.info('No active videos to update');
      return;
    }

    logger.info(`Updating metrics for ${videos.rows.length} videos`);

    let successCount = 0;
    let failCount = 0;

    for (const video of videos.rows) {
      try {
        // TikTok 메트릭 크롤링
        if (video.platform === 'tiktok') {
          const metrics = await scrapeVideoMetrics(video.video_url);

          if (metrics.success) {
            await query(
              `UPDATE videos
               SET
                 current_views = $1,
                 current_likes = $2,
                 current_comments = $3,
                 current_shares = $4,
                 metrics_updated_at = CURRENT_TIMESTAMP
               WHERE video_id = $5`,
              [
                metrics.views,
                metrics.likes,
                metrics.comments,
                metrics.shares,
                video.video_id
              ]
            );

            successCount++;
            logger.debug(`Updated metrics for video: ${video.video_id}`);
          } else {
            failCount++;
            logger.warn(`Failed to scrape metrics for video: ${video.video_id}`);
          }
        }

        // Rate limiting (2초 대기)
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        logger.error(`Error updating video ${video.video_id}: ${error.message}`);
        failCount++;
      }
    }

    logger.info(`Metrics update completed: ${successCount} succeeded, ${failCount} failed`);

  } catch (error) {
    logger.error(`Metrics update job error: ${error.message}`);
    throw error;
  }
}

export default updateVideoMetrics;
