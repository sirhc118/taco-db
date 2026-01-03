import { query, transaction } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

// 사용자 포인트 잔액 조회
export const getUserBalance = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const result = await query(
    `SELECT user_id, total_points, level
     FROM users
     WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: {
      userId: result.rows[0].user_id,
      balance: result.rows[0].total_points,
      level: result.rows[0].level
    }
  });
});

// 사용자 포인트 거래 내역 조회
export const getUserTransactions = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { limit = 50, offset = 0, type } = req.query;

  let queryText = `
    SELECT
      transaction_id,
      amount,
      balance_after,
      transaction_type,
      reference_id,
      reason,
      created_at
    FROM point_transactions
    WHERE user_id = $1
  `;

  const params = [userId];

  if (type) {
    queryText += ` AND transaction_type = $${params.length + 1}`;
    params.push(type);
  }

  queryText += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await query(queryText, params);

  res.json({
    success: true,
    count: result.rows.length,
    data: result.rows
  });
});

// 포인트 지급 (어드민 또는 시스템)
export const grantPoints = asyncHandler(async (req, res) => {
  const {
    userId,
    amount,
    transactionType = 'admin_grant',
    referenceId,
    reason,
    createdBy
  } = req.body;

  if (!userId || !amount) {
    throw new AppError('userId and amount are required', 400);
  }

  if (amount <= 0) {
    throw new AppError('Amount must be positive', 400);
  }

  const result = await transaction(async (client) => {
    // 사용자 포인트 업데이트
    const userResult = await client.query(
      `UPDATE users
       SET total_points = total_points + $1
       WHERE user_id = $2
       RETURNING total_points`,
      [amount, userId]
    );

    if (userResult.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    const newBalance = userResult.rows[0].total_points;

    // 거래 기록 생성
    const transactionId = uuidv4();
    const transactionResult = await client.query(
      `INSERT INTO point_transactions (
        transaction_id, user_id, amount, balance_after,
        transaction_type, reference_id, reason, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        transactionId,
        userId,
        amount,
        newBalance,
        transactionType,
        referenceId,
        reason,
        createdBy
      ]
    );

    return {
      transaction: transactionResult.rows[0],
      newBalance
    };
  });

  logger.info(`Points granted: ${userId}, amount: ${amount}, type: ${transactionType}`);

  res.status(201).json({
    success: true,
    message: `${amount} NACHO granted successfully`,
    data: result
  });
});

// 포인트 차감 (바우처 교환 등)
export const deductPoints = asyncHandler(async (req, res) => {
  const {
    userId,
    amount,
    transactionType = 'redemption_deduct',
    referenceId,
    reason
  } = req.body;

  if (!userId || !amount) {
    throw new AppError('userId and amount are required', 400);
  }

  if (amount <= 0) {
    throw new AppError('Amount must be positive', 400);
  }

  const result = await transaction(async (client) => {
    // 현재 잔액 확인
    const balanceResult = await client.query(
      `SELECT total_points FROM users WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    if (balanceResult.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    const currentBalance = balanceResult.rows[0].total_points;

    if (currentBalance < amount) {
      throw new AppError(
        `Insufficient balance. Current: ${currentBalance} NACHO, Required: ${amount} NACHO`,
        400
      );
    }

    // 포인트 차감
    const userResult = await client.query(
      `UPDATE users
       SET total_points = total_points - $1
       WHERE user_id = $2
       RETURNING total_points`,
      [amount, userId]
    );

    const newBalance = userResult.rows[0].total_points;

    // 거래 기록 생성 (음수로 저장)
    const transactionId = uuidv4();
    const transactionResult = await client.query(
      `INSERT INTO point_transactions (
        transaction_id, user_id, amount, balance_after,
        transaction_type, reference_id, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        transactionId,
        userId,
        -amount, // 음수로 저장
        newBalance,
        transactionType,
        referenceId,
        reason
      ]
    );

    return {
      transaction: transactionResult.rows[0],
      newBalance
    };
  });

  logger.info(`Points deducted: ${userId}, amount: ${amount}, type: ${transactionType}`);

  res.status(201).json({
    success: true,
    message: `${amount} NACHO deducted successfully`,
    data: result
  });
});

export default {
  getUserBalance,
  getUserTransactions,
  grantPoints,
  deductPoints
};
