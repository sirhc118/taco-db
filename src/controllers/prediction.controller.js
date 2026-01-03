import { query, transaction } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';

export const createPrediction = asyncHandler(async (req, res) => {
  const predictionId = uuidv4();
  const result = await query(
    `INSERT INTO predictions (prediction_id, video_url, title, prediction_type,
      prediction_format, target_value, range_options, deadline, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [predictionId, req.body.videoUrl, req.body.title, req.body.predictionType,
      req.body.predictionFormat, req.body.targetValue, JSON.stringify(req.body.rangeOptions),
      req.body.deadline, 'active', req.body.createdBy]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const getPrediction = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM predictions WHERE prediction_id = $1', [req.params.predictionId]);
  if (result.rows.length === 0) throw new AppError('Prediction not found', 404);
  res.json({ success: true, data: result.rows[0] });
});

export const getActivePredictions = asyncHandler(async (req, res) => {
  const result = await query("SELECT * FROM predictions WHERE status = 'active' ORDER BY deadline ASC");
  res.json({ success: true, count: result.rows.length, data: result.rows });
});

export const submitVote = asyncHandler(async (req, res) => {
  const { userId, choice } = req.body;
  const { predictionId } = req.params;

  const result = await query(
    `INSERT INTO user_predictions (user_id, prediction_id, choice)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, prediction_id)
     DO UPDATE SET choice = $3
     RETURNING *`,
    [userId, predictionId, choice]
  );

  res.status(201).json({ success: true, data: result.rows[0] });
});

export const settlePrediction = asyncHandler(async (req, res) => {
  const { predictionId } = req.params;
  const { actualValue, correctAnswer } = req.body;

  await transaction(async (client) => {
    // Update prediction
    await client.query(
      `UPDATE predictions
       SET actual_value = $1, correct_answer = $2, status = 'settled', settled_at = NOW()
       WHERE prediction_id = $3`,
      [actualValue, correctAnswer, predictionId]
    );

    // Award points to winners
    const SIMPLE_REWARD = 10;
    const RANGE_REWARD = 15;

    const winners = await client.query(
      `SELECT user_id FROM user_predictions
       WHERE prediction_id = $1 AND choice = $2`,
      [predictionId, correctAnswer]
    );

    const prediction = await client.query(
      'SELECT prediction_format FROM predictions WHERE prediction_id = $1',
      [predictionId]
    );

    const pointsPerWinner = prediction.rows[0].prediction_format === 'simple' ? SIMPLE_REWARD : RANGE_REWARD;

    for (const winner of winners.rows) {
      const userResult = await client.query(
        'UPDATE users SET total_points = total_points + $1 WHERE user_id = $2 RETURNING total_points',
        [pointsPerWinner, winner.user_id]
      );

      const transactionId = uuidv4();
      await client.query(
        `INSERT INTO point_transactions (transaction_id, user_id, amount, balance_after,
          transaction_type, reference_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [transactionId, winner.user_id, pointsPerWinner, userResult.rows[0].total_points,
          'prediction_win', predictionId, 'Prediction game win']
      );

      await client.query(
        `UPDATE user_predictions
         SET is_correct = true, points_awarded = $1
         WHERE user_id = $2 AND prediction_id = $3`,
        [pointsPerWinner, winner.user_id, predictionId]
      );
    }
  });

  res.json({ success: true, message: 'Prediction settled' });
});

export const getUserPredictions = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT * FROM user_predictions WHERE user_id = $1 ORDER BY voted_at DESC',
    [req.params.userId]
  );
  res.json({ success: true, count: result.rows.length, data: result.rows });
});

export default {
  createPrediction,
  getPrediction,
  getActivePredictions,
  submitVote,
  settlePrediction,
  getUserPredictions
};
