import { query, transaction } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

// 사용자 생성 (taco-auth에서 호출)
export const createUser = asyncHandler(async (req, res) => {
  const {
    userId, // Discord user ID
    discordUsername,
    discordDiscriminator,
    tiktokOpenId,
    tiktokUnionId,
    tiktokUsername,
    tiktokDisplayName,
    tiktokAvatarUrl,
    tiktokFollowersCount,
    tiktokFollowingCount,
    region,
    email
  } = req.body;

  // 필수 필드 확인
  if (!userId || !discordUsername) {
    throw new AppError('userId and discordUsername are required', 400);
  }

  try {
    const result = await transaction(async (client) => {
      // 사용자 생성
      const userResult = await client.query(
        `INSERT INTO users (
          user_id, discord_username, discord_discriminator,
          tiktok_open_id, tiktok_union_id, tiktok_username,
          tiktok_display_name, tiktok_avatar_url,
          tiktok_followers_count, tiktok_following_count,
          region, email, is_verified, last_login_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (user_id)
        DO UPDATE SET
          discord_username = EXCLUDED.discord_username,
          tiktok_open_id = EXCLUDED.tiktok_open_id,
          tiktok_union_id = EXCLUDED.tiktok_union_id,
          tiktok_username = EXCLUDED.tiktok_username,
          tiktok_display_name = EXCLUDED.tiktok_display_name,
          tiktok_avatar_url = EXCLUDED.tiktok_avatar_url,
          tiktok_followers_count = EXCLUDED.tiktok_followers_count,
          tiktok_following_count = EXCLUDED.tiktok_following_count,
          is_verified = EXCLUDED.is_verified,
          last_login_at = EXCLUDED.last_login_at,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
        [
          userId,
          discordUsername,
          discordDiscriminator,
          tiktokOpenId,
          tiktokUnionId,
          tiktokUsername,
          tiktokDisplayName,
          tiktokAvatarUrl,
          tiktokFollowersCount || 0,
          tiktokFollowingCount || 0,
          region,
          email,
          tiktokOpenId ? true : false, // TikTok 정보가 있으면 인증됨
          new Date()
        ]
      );

      return userResult.rows[0];
    });

    logger.info(`User created/updated: ${userId}`);

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error(`Error creating user: ${error.message}`);
    throw error;
  }
});

// 사용자 조회
export const getUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const result = await query(
    `SELECT
      u.*,
      COALESCE(
        json_agg(
          DISTINCT uc.category
        ) FILTER (WHERE uc.category IS NOT NULL),
        '[]'
      ) as categories
    FROM users u
    LEFT JOIN user_categories uc ON u.user_id = uc.user_id
    WHERE u.user_id = $1
    GROUP BY u.user_id`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: result.rows[0]
  });
});

// 사용자 정보 업데이트
export const updateUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const updates = req.body;

  // 업데이트 가능한 필드만 허용
  const allowedFields = [
    'discord_username',
    'discord_discriminator',
    'email',
    'tiktok_username',
    'tiktok_display_name',
    'tiktok_avatar_url',
    'tiktok_followers_count',
    'tiktok_following_count'
  ];

  const updateFields = Object.keys(updates).filter(key => allowedFields.includes(key));

  if (updateFields.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  const setClause = updateFields.map((field, index) => `${field} = $${index + 2}`).join(', ');
  const values = [userId, ...updateFields.map(field => updates[field])];

  const result = await query(
    `UPDATE users
     SET ${setClause}, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  logger.info(`User updated: ${userId}`);

  res.json({
    success: true,
    data: result.rows[0]
  });
});

// 사용자 카테고리 업데이트
export const updateUserCategories = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { categories } = req.body; // ["beauty", "tech", "food"]

  if (!Array.isArray(categories)) {
    throw new AppError('Categories must be an array', 400);
  }

  const validCategories = [
    'beauty', 'tech', 'food', 'fashion', 'web3', 'sports',
    'travel', 'gaming', 'music', 'fitness', 'pets', 'dance',
    'finance', 'automotive', 'meme'
  ];

  const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
  if (invalidCategories.length > 0) {
    throw new AppError(`Invalid categories: ${invalidCategories.join(', ')}`, 400);
  }

  await transaction(async (client) => {
    // 기존 카테고리 삭제
    await client.query('DELETE FROM user_categories WHERE user_id = $1', [userId]);

    // 새 카테고리 추가
    if (categories.length > 0) {
      const values = categories.map((cat, index) => {
        return `($1, $${index + 2})`;
      }).join(', ');

      await client.query(
        `INSERT INTO user_categories (user_id, category) VALUES ${values}`,
        [userId, ...categories]
      );
    }
  });

  logger.info(`User categories updated: ${userId}, categories: ${categories.join(', ')}`);

  res.json({
    success: true,
    message: 'Categories updated successfully',
    data: { categories }
  });
});

// 사용자 지역 변경 (60일 쿨다운 체크)
export const updateUserRegion = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { region } = req.body;

  if (!region) {
    throw new AppError('Region is required', 400);
  }

  // 최근 지역 변경 이력 확인 (60일 이내)
  const historyResult = await query(
    `SELECT changed_at
     FROM user_region_history
     WHERE user_id = $1
     ORDER BY changed_at DESC
     LIMIT 1`,
    [userId]
  );

  if (historyResult.rows.length > 0) {
    const lastChanged = new Date(historyResult.rows[0].changed_at);
    const daysSinceChange = (Date.now() - lastChanged.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceChange < 60) {
      const daysRemaining = Math.ceil(60 - daysSinceChange);
      throw new AppError(
        `You can change your region again in ${daysRemaining} days`,
        429
      );
    }
  }

  // 트랜잭션으로 지역 업데이트 및 이력 저장
  const result = await transaction(async (client) => {
    // 현재 지역 조회
    const currentUser = await client.query(
      'SELECT region FROM users WHERE user_id = $1',
      [userId]
    );

    const oldRegion = currentUser.rows[0]?.region;

    // 지역 업데이트
    const updateResult = await client.query(
      `UPDATE users
       SET region = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2
       RETURNING *`,
      [region, userId]
    );

    // 이력 저장
    await client.query(
      `INSERT INTO user_region_history (user_id, old_region, new_region)
       VALUES ($1, $2, $3)`,
      [userId, oldRegion, region]
    );

    return updateResult.rows[0];
  });

  logger.info(`User region updated: ${userId}, new region: ${region}`);

  res.json({
    success: true,
    message: 'Region updated successfully',
    data: result
  });
});

// 사용자 통계 조회
export const getUserStats = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const result = await query(
    `SELECT
      u.user_id,
      u.total_points,
      u.level,
      u.total_tasks_completed,
      COUNT(DISTINCT t.task_id) FILTER (WHERE t.status = 'verified') as verified_tasks,
      COUNT(DISTINCT t.task_id) FILTER (WHERE t.status = 'completed') as completed_tasks,
      COUNT(DISTINCT t.task_id) FILTER (WHERE t.status = 'assigned') as pending_tasks,
      COALESCE(SUM(pt.amount) FILTER (WHERE pt.amount > 0), 0) as total_earned,
      COALESCE(SUM(pt.amount) FILTER (WHERE pt.amount < 0), 0) as total_spent,
      COUNT(DISTINCT r.redemption_id) FILTER (WHERE r.status = 'approved') as total_redemptions
    FROM users u
    LEFT JOIN tasks t ON u.user_id = t.user_id
    LEFT JOIN point_transactions pt ON u.user_id = pt.user_id
    LEFT JOIN redemptions r ON u.user_id = r.user_id
    WHERE u.user_id = $1
    GROUP BY u.user_id`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: result.rows[0]
  });
});

export default {
  createUser,
  getUser,
  updateUser,
  updateUserCategories,
  updateUserRegion,
  getUserStats
};
