import { query, transaction } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

// 바우처 교환 신청 생성 (taco-reward 봇에서 호출)
export const createRedemption = asyncHandler(async (req, res) => {
  const {
    userId,
    voucherId,
    voucherName,
    amountNacho,
    amountUsd
  } = req.body;

  if (!userId || !voucherId || !amountNacho) {
    throw new AppError('userId, voucherId, and amountNacho are required', 400);
  }

  const result = await transaction(async (client) => {
    // 현재 잔액 확인
    const userResult = await client.query(
      'SELECT total_points FROM users WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    const currentBalance = userResult.rows[0].total_points;

    if (currentBalance < amountNacho) {
      throw new AppError(
        `Insufficient balance. Current: ${currentBalance} NACHO, Required: ${amountNacho} NACHO`,
        400
      );
    }

    // 포인트 차감
    await client.query(
      'UPDATE users SET total_points = total_points - $1 WHERE user_id = $2',
      [amountNacho, userId]
    );

    const newBalance = currentBalance - amountNacho;

    // 교환 신청 생성
    const redemptionId = uuidv4();
    const redemptionResult = await client.query(
      `INSERT INTO redemptions (
        redemption_id, user_id, voucher_id, voucher_name,
        amount_nacho, amount_usd, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        redemptionId,
        userId,
        voucherId,
        voucherName,
        amountNacho,
        amountUsd,
        'pending'
      ]
    );

    // 포인트 거래 기록
    const transactionId = uuidv4();
    await client.query(
      `INSERT INTO point_transactions (
        transaction_id, user_id, amount, balance_after,
        transaction_type, reference_id, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        transactionId,
        userId,
        -amountNacho,
        newBalance,
        'redemption_deduct',
        redemptionId,
        `Voucher redemption: ${voucherName}`
      ]
    );

    return redemptionResult.rows[0];
  });

  logger.info(`Redemption created: ${result.redemption_id}, user: ${userId}`);

  res.status(201).json({
    success: true,
    message: 'Redemption request submitted',
    data: result
  });
});

// 나머지 간단한 컨트롤러 함수들...
export const getRedemption = asyncHandler(async (req, res) => {
  const { redemptionId } = req.params;
  const result = await query('SELECT * FROM redemptions WHERE redemption_id = $1', [redemptionId]);
  if (result.rows.length === 0) throw new AppError('Redemption not found', 404);
  res.json({ success: true, data: result.rows[0] });
});

export const getUserRedemptions = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const result = await query(
    'SELECT * FROM redemptions WHERE user_id = $1 ORDER BY requested_at DESC',
    [userId]
  );
  res.json({ success: true, count: result.rows.length, data: result.rows });
});

export const getPendingRedemptions = asyncHandler(async (req, res) => {
  const result = await query(
    "SELECT * FROM redemptions WHERE status = 'pending' ORDER BY requested_at ASC"
  );
  res.json({ success: true, count: result.rows.length, data: result.rows });
});

export const approveRedemption = asyncHandler(async (req, res) => {
  const { redemptionId } = req.params;
  const { reviewedBy, voucherLink } = req.body;

  const result = await query(
    `UPDATE redemptions
     SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
         voucher_link = $2, delivered_at = NOW()
     WHERE redemption_id = $3
     RETURNING *`,
    [reviewedBy, voucherLink, redemptionId]
  );

  if (result.rows.length === 0) throw new AppError('Redemption not found', 404);

  logger.info(`Redemption approved: ${redemptionId}`);
  res.json({ success: true, data: result.rows[0] });
});

export const denyRedemption = asyncHandler(async (req, res) => {
  const { redemptionId } = req.params;
  const { reviewedBy, reviewNote } = req.body;

  const result = await transaction(async (client) => {
    const redemption = await client.query(
      'SELECT user_id, amount_nacho FROM redemptions WHERE redemption_id = $1',
      [redemptionId]
    );

    if (redemption.rows.length === 0) throw new AppError('Redemption not found', 404);

    const { user_id, amount_nacho } = redemption.rows[0];

    // 포인트 환불
    const userResult = await client.query(
      'UPDATE users SET total_points = total_points + $1 WHERE user_id = $2 RETURNING total_points',
      [amount_nacho, user_id]
    );

    // 교환 거부
    const redemptionResult = await client.query(
      `UPDATE redemptions
       SET status = 'denied', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
       WHERE redemption_id = $3
       RETURNING *`,
      [reviewedBy, reviewNote, redemptionId]
    );

    // 환불 거래 기록
    const transactionId = uuidv4();
    await client.query(
      `INSERT INTO point_transactions (
        transaction_id, user_id, amount, balance_after,
        transaction_type, reference_id, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        transactionId,
        user_id,
        amount_nacho,
        userResult.rows[0].total_points,
        'redemption_refund',
        redemptionId,
        `Redemption denied: ${reviewNote || 'No reason provided'}`
      ]
    );

    return redemptionResult.rows[0];
  });

  logger.info(`Redemption denied: ${redemptionId}`);
  res.json({ success: true, data: result });
});

export const cancelRedemption = asyncHandler(async (req, res) => {
  // Similar to denyRedemption but initiated by user
  const { redemptionId } = req.params;
  const { userId } = req.body;

  const result = await transaction(async (client) => {
    const redemption = await client.query(
      "SELECT user_id, amount_nacho FROM redemptions WHERE redemption_id = $1 AND status = 'pending'",
      [redemptionId]
    );

    if (redemption.rows.length === 0) throw new AppError('Redemption not found or cannot be cancelled', 404);

    if (redemption.rows[0].user_id !== userId) {
      throw new AppError('Unauthorized', 403);
    }

    const { amount_nacho } = redemption.rows[0];

    // 포인트 환불
    const userResult = await client.query(
      'UPDATE users SET total_points = total_points + $1 WHERE user_id = $2 RETURNING total_points',
      [amount_nacho, userId]
    );

    // 교환 취소
    const redemptionResult = await client.query(
      "UPDATE redemptions SET status = 'cancelled', reviewed_at = NOW() WHERE redemption_id = $1 RETURNING *",
      [redemptionId]
    );

    // 환불 거래 기록
    const transactionId = uuidv4();
    await client.query(
      `INSERT INTO point_transactions (
        transaction_id, user_id, amount, balance_after,
        transaction_type, reference_id, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        transactionId,
        userId,
        amount_nacho,
        userResult.rows[0].total_points,
        'redemption_refund',
        redemptionId,
        'Redemption cancelled by user'
      ]
    );

    return redemptionResult.rows[0];
  });

  logger.info(`Redemption cancelled: ${redemptionId}`);
  res.json({ success: true, data: result });
});

export default {
  createRedemption,
  getRedemption,
  getUserRedemptions,
  getPendingRedemptions,
  approveRedemption,
  denyRedemption,
  cancelRedemption
};
