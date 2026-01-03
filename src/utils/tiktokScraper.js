import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from './logger.js';

// TikTok 댓글 크롤링 (공개 API 또는 웹 스크래핑)
export async function scrapeCommentFromUrl(commentUrl) {
  try {
    // User-Agent 설정
    const headers = {
      'User-Agent': process.env.TIKTOK_USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    // TikTok 댓글 URL에서 비디오 ID와 댓글 ID 추출
    // 예: https://www.tiktok.com/@username/video/123456789?comment_id=987654321
    const urlObj = new URL(commentUrl);
    const videoId = urlObj.pathname.split('/').pop();
    const commentId = urlObj.searchParams.get('comment_id');

    if (!videoId || !commentId) {
      throw new Error('Invalid comment URL format');
    }

    // TikTok 웹페이지 크롤링
    const response = await axios.get(commentUrl, { headers, timeout: 10000 });
    const html = response.data;
    const $ = cheerio.load(html);

    // ⚠️ 주의: TikTok의 HTML 구조는 자주 변경됩니다
    // 실제 환경에서는 TikTok API 사용을 권장합니다
    // 여기서는 기본적인 스크래핑 예시만 제공합니다

    // 댓글 텍스트 추출 (예시)
    let commentText = null;
    let isFound = false;

    // TikTok은 client-side rendering을 사용하므로
    // 실제로는 headless browser (Puppeteer/Playwright)가 필요할 수 있습니다

    // JSON 데이터에서 추출 시도
    const scriptTags = $('script[type="application/json"]');
    scriptTags.each((i, elem) => {
      try {
        const jsonData = JSON.parse($(elem).html());
        // 댓글 데이터 찾기
        if (jsonData && jsonData.comments) {
          const comment = jsonData.comments.find(c => c.cid === commentId);
          if (comment) {
            commentText = comment.text;
            isFound = true;
            return false; // break
          }
        }
      } catch (e) {
        // JSON 파싱 실패 무시
      }
    });

    if (isFound) {
      return {
        success: true,
        commentId,
        commentText,
        exists: true
      };
    }

    // 댓글을 찾지 못한 경우
    logger.warn(`Comment not found: ${commentUrl}`);

    return {
      success: false,
      commentId,
      commentText: null,
      exists: false,
      error: 'Comment not found or deleted'
    };

  } catch (error) {
    logger.error(`Error scraping comment: ${error.message}`);

    return {
      success: false,
      commentId: null,
      commentText: null,
      exists: false,
      error: error.message
    };
  }
}

// TikTok 비디오 메트릭 크롤링
export async function scrapeVideoMetrics(videoUrl) {
  try {
    const headers = {
      'User-Agent': process.env.TIKTOK_USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    const response = await axios.get(videoUrl, { headers, timeout: 10000 });
    const html = response.data;
    const $ = cheerio.load(html);

    let metrics = {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0
    };

    // JSON 데이터에서 메트릭 추출
    const scriptTags = $('script[type="application/json"]');
    scriptTags.each((i, elem) => {
      try {
        const jsonData = JSON.parse($(elem).html());

        if (jsonData && jsonData.stats) {
          metrics.views = parseInt(jsonData.stats.playCount) || 0;
          metrics.likes = parseInt(jsonData.stats.diggCount) || 0;
          metrics.comments = parseInt(jsonData.stats.commentCount) || 0;
          metrics.shares = parseInt(jsonData.stats.shareCount) || 0;
          return false; // break
        }
      } catch (e) {
        // JSON 파싱 실패 무시
      }
    });

    logger.info(`Video metrics scraped: ${videoUrl}`);

    return {
      success: true,
      ...metrics
    };

  } catch (error) {
    logger.error(`Error scraping video metrics: ${error.message}`);

    return {
      success: false,
      error: error.message
    };
  }
}

// YouTube Shorts 메트릭 크롤링 (추후 구현)
export async function scrapeYouTubeMetrics(videoUrl) {
  // YouTube Data API v3 사용 권장
  throw new Error('YouTube scraping not implemented yet');
}

export default {
  scrapeCommentFromUrl,
  scrapeVideoMetrics,
  scrapeYouTubeMetrics
};
