import { query, transaction } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

// 태스크 할당 (taco-task 봇에서 호출)
export const assignTasks = asyncHandler(async (req, res) => {
  const { userId, count = 10 } = req.body;

  if (!userId) {
    throw new AppError('userId is required', 400);
  }

  // 사용자 정보 및 카테고리 조회
  const userResult = await query(
    `SELECT
      u.*,
      COALESCE(json_agg(DISTINCT uc.category) FILTER (WHERE uc.category IS NOT NULL), '[]') as categories
    FROM users u
    LEFT JOIN user_categories uc ON u.user_id = uc.user_id
    WHERE u.user_id = $1
    GROUP BY u.user_id`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const user = userResult.rows[0];
  const userCategories = user.categories;
  const userRegion = user.region;

  // 30분 쿨다운 체크
  const recentSession = await query(
    `SELECT session_id, started_at, expired_at
     FROM task_sessions
     WHERE user_id = $1
     AND started_at > NOW() - INTERVAL '30 minutes'
     ORDER BY started_at DESC
     LIMIT 1`,
    [userId]
  );

  if (recentSession.rows.length > 0) {
    const session = recentSession.rows[0];
    const remainingTime = Math.ceil((new Date(session.expired_at) - new Date()) / 1000 / 60);

    if (remainingTime > 0) {
      throw new AppError(
        `Please wait ${remainingTime} minutes before requesting new tasks`,
        429
      );
    }
  }

  // 태스크 할당 로직
  const result = await transaction(async (client) => {
    // 1. 새 세션 생성
    const sessionId = uuidv4();
    const expiredAt = new Date(Date.now() + 30 * 60 * 1000); // 30분 후

    await client.query(
      `INSERT INTO task_sessions (session_id, user_id, assigned_count, expired_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, userId, count, expiredAt]
    );

    // 2. 활성 캠페인에서 영상 선택
    // 70% 카테고리 매칭, 30% 랜덤
    const categoryMatchCount = Math.floor(count * 0.7);
    const randomCount = count - categoryMatchCount;

    let selectedVideos = [];

    // 카테고리 매칭 영상 선택
    if (userCategories.length > 0 && categoryMatchCount > 0) {
      const categoryVideos = await client.query(
        `SELECT DISTINCT ON (v.title) v.video_id, v.video_url, v.title, v.campaign_id, c.category
         FROM videos v
         JOIN campaigns c ON v.campaign_id = c.campaign_id
         LEFT JOIN video_assignment_tracker vat ON v.video_id = vat.video_id
           AND vat.assigned_at > NOW() - INTERVAL '60 minutes'
         WHERE c.status = 'active'
         AND c.category = ANY($1)
         AND (c.country = 'global' OR c.country = $2 OR $2 IS NULL)
         AND c.start_date <= CURRENT_DATE
         AND c.end_date >= CURRENT_DATE
         GROUP BY v.video_id, v.title, c.category
         HAVING COUNT(vat.id) < 10
         ORDER BY v.title, RANDOM()
         LIMIT $3`,
        [userCategories, userRegion, categoryMatchCount]
      );

      selectedVideos = categoryVideos.rows;
    }

    // 랜덤 영상 선택 (부족한 수만큼)
    const remainingCount = count - selectedVideos.length;
    if (remainingCount > 0) {
      const randomVideos = await client.query(
        `SELECT DISTINCT ON (v.title) v.video_id, v.video_url, v.title, v.campaign_id, c.category
         FROM videos v
         JOIN campaigns c ON v.campaign_id = c.campaign_id
         LEFT JOIN video_assignment_tracker vat ON v.video_id = vat.video_id
           AND vat.assigned_at > NOW() - INTERVAL '60 minutes'
         WHERE c.status = 'active'
         AND (c.country = 'global' OR c.country = $1 OR $1 IS NULL)
         AND c.start_date <= CURRENT_DATE
         AND c.end_date >= CURRENT_DATE
         AND v.video_id NOT IN (
           SELECT video_id FROM unnest($2::text[]) AS video_id
         )
         GROUP BY v.video_id, v.title, c.category
         HAVING COUNT(vat.id) < 10
         ORDER BY v.title, RANDOM()
         LIMIT $3`,
        [
          userRegion,
          selectedVideos.map(v => v.video_id),
          remainingCount
        ]
      );

      selectedVideos = [...selectedVideos, ...randomVideos.rows];
    }

    if (selectedVideos.length === 0) {
      throw new AppError('No available tasks at the moment', 404);
    }

    // 3. 태스크 생성
    const tasks = [];
    for (const video of selectedVideos) {
      const taskId = uuidv4();

      const taskResult = await client.query(
        `INSERT INTO tasks (
          task_id, session_id, user_id, campaign_id, video_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [taskId, sessionId, userId, video.campaign_id, video.video_id, 'assigned']
      );

      // 할당 트래커에 기록
      await client.query(
        `INSERT INTO video_assignment_tracker (video_id, user_id)
         VALUES ($1, $2)`,
        [video.video_id, userId]
      );

      tasks.push({
        ...taskResult.rows[0],
        video_url: video.video_url,
        title: video.title,
        category: video.category
      });
    }

    // 4. 세션 업데이트
    await client.query(
      `UPDATE task_sessions
       SET assigned_count = $1
       WHERE session_id = $2`,
      [tasks.length, sessionId]
    );

    return {
      sessionId,
      tasks,
      expiredAt
    };
  });

  logger.info(`Tasks assigned: ${userId}, session: ${result.sessionId}, count: ${result.tasks.length}`);

  res.status(201).json({
    success: true,
    data: result
  });
});

// 태스크 세션 조회
export const getTaskSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const result = await query(
    `SELECT
      ts.*,
      json_agg(
        json_build_object(
          'task_id', t.task_id,
          'video_id', t.video_id,
          'video_url', v.video_url,
          'title', v.title,
          'status', t.status,
          'comment_url', t.comment_url,
          'completed_at', t.completed_at
        )
      ) as tasks
    FROM task_sessions ts
    LEFT JOIN tasks t ON ts.session_id = t.session_id
    LEFT JOIN videos v ON t.video_id = v.video_id
    WHERE ts.session_id = $1
    GROUP BY ts.session_id`,
    [sessionId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Task session not found', 404);
  }

  res.json({
    success: true,
    data: result.rows[0]
  });
});

// 사용자의 태스크 목록 조회
export const getTasksForUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { status, limit = 50, offset = 0 } = req.query;

  let queryText = `
    SELECT
      t.*,
      v.video_url,
      v.title,
      v.thumbnail_url,
      c.campaign_name,
      c.category
    FROM tasks t
    JOIN videos v ON t.video_id = v.video_id
    JOIN campaigns c ON t.campaign_id = c.campaign_id
    WHERE t.user_id = $1
  `;

  const params = [userId];

  if (status) {
    queryText += ` AND t.status = $${params.length + 1}`;
    params.push(status);
  }

  queryText += ` ORDER BY t.assigned_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await query(queryText, params);

  res.json({
    success: true,
    count: result.rows.length,
    data: result.rows
  });
});

// 개별 태스크 조회
export const getTaskById = asyncHandler(async (req, res) => {
  const { taskId } = req.params;

  const result = await query(
    `SELECT
      t.*,
      v.video_url,
      v.title,
      v.thumbnail_url,
      c.campaign_name,
      c.category
    FROM tasks t
    JOIN videos v ON t.video_id = v.video_id
    JOIN campaigns c ON t.campaign_id = c.campaign_id
    WHERE t.task_id = $1`,
    [taskId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Task not found', 404);
  }

  res.json({
    success: true,
    data: result.rows[0]
  });
});

// 태스크 완료 처리 (사용자가 댓글 URL 제출)
export const completeTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  const { commentUrl, commentText } = req.body;

  if (!commentUrl) {
    throw new AppError('commentUrl is required', 400);
  }

  const result = await query(
    `UPDATE tasks
     SET
       status = 'completed',
       comment_url = $1,
       comment_text = $2,
       completed_at = CURRENT_TIMESTAMP
     WHERE task_id = $3
     RETURNING *`,
    [commentUrl, commentText, taskId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Task not found', 404);
  }

  // 세션의 완료 카운트 업데이트
  await query(
    `UPDATE task_sessions
     SET completed_count = (
       SELECT COUNT(*) FROM tasks
       WHERE session_id = $1 AND status IN ('completed', 'verified')
     )
     WHERE session_id = $1`,
    [result.rows[0].session_id]
  );

  logger.info(`Task completed: ${taskId}`);

  res.json({
    success: true,
    message: 'Task marked as completed',
    data: result.rows[0]
  });
});

// 태스크 검증 (댓글 크롤링 후 확인)
export const verifyTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  const { commentId, isVerified, rejectionReason } = req.body;

  if (typeof isVerified !== 'boolean') {
    throw new AppError('isVerified is required', 400);
  }

  const result = await transaction(async (client) => {
    if (isVerified) {
      // 검증 성공 - 1주일 후 재검증 스케줄링
      const recheckAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const taskResult = await client.query(
        `UPDATE tasks
         SET
           status = 'verified',
           comment_id = $1,
           first_verified_at = CURRENT_TIMESTAMP,
           recheck_scheduled_at = $2,
           verified_at = CURRENT_TIMESTAMP
         WHERE task_id = $3
         RETURNING *`,
        [commentId, recheckAt, taskId]
      );

      if (taskResult.rows.length === 0) {
        throw new AppError('Task not found', 404);
      }

      const task = taskResult.rows[0];

      // 댓글 재검증 큐에 추가
      await client.query(
        `INSERT INTO comment_verification_queue (
          task_id, video_url, comment_id, user_id, scheduled_at
        )
        SELECT $1, v.video_url, $2, $3, $4
        FROM videos v
        WHERE v.video_id = $5`,
        [taskId, commentId, task.user_id, recheckAt, task.video_id]
      );

      logger.info(`Task verified: ${taskId}, recheck scheduled at ${recheckAt}`);

      return taskResult.rows[0];
    } else {
      // 검증 실패
      const taskResult = await client.query(
        `UPDATE tasks
         SET
           status = 'failed',
           rejection_reason = $1
         WHERE task_id = $2
         RETURNING *`,
        [rejectionReason || 'Comment not found or invalid', taskId]
      );

      logger.warn(`Task verification failed: ${taskId}, reason: ${rejectionReason}`);

      return taskResult.rows[0];
    }
  });

  res.json({
    success: true,
    message: isVerified ? 'Task verified successfully' : 'Task verification failed',
    data: result
  });
});

// 태스크 재검증 (1주일 후, 크론잡에서 호출)
export const recheckTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  const { commentMaintained } = req.body;

  if (typeof commentMaintained !== 'boolean') {
    throw new AppError('commentMaintained is required', 400);
  }

  const result = await transaction(async (client) => {
    if (commentMaintained) {
      // 댓글 유지 확인됨 - 포인트 지급
      const POINTS_PER_TASK = 20; // 1건당 20 NACHO

      const taskResult = await client.query(
        `UPDATE tasks
         SET
           is_comment_maintained = true,
           recheck_verified_at = CURRENT_TIMESTAMP,
           points_awarded = $1,
           points_awarded_at = CURRENT_TIMESTAMP
         WHERE task_id = $2
         RETURNING *`,
        [POINTS_PER_TASK, taskId]
      );

      if (taskResult.rows.length === 0) {
        throw new AppError('Task not found', 404);
      }

      const task = taskResult.rows[0];

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
          taskId,
          'Task completed and comment maintained for 7 days'
        ]
      );

      logger.info(`Points awarded: ${task.user_id}, amount: ${POINTS_PER_TASK}, task: ${taskId}`);

      return {
        ...taskResult.rows[0],
        points_awarded: POINTS_PER_TASK,
        new_balance: newBalance
      };
    } else {
      // 댓글 삭제됨 - 포인트 지급 없음
      const taskResult = await client.query(
        `UPDATE tasks
         SET
           is_comment_maintained = false,
           recheck_verified_at = CURRENT_TIMESTAMP
         WHERE task_id = $1
         RETURNING *`,
        [taskId]
      );

      logger.warn(`Task recheck failed - comment deleted: ${taskId}`);

      return taskResult.rows[0];
    }
  });

  // 검증 큐에서 제거
  await query(
    `UPDATE comment_verification_queue
     SET status = 'completed', processed_at = CURRENT_TIMESTAMP
     WHERE task_id = $1`,
    [taskId]
  );

  res.json({
    success: true,
    message: commentMaintained
      ? 'Comment maintained - points awarded'
      : 'Comment deleted - no points awarded',
    data: result
  });
});

export default {
  assignTasks,
  getTaskSession,
  getTasksForUser,
  getTaskById,
  completeTask,
  verifyTask,
  recheckTask
};
