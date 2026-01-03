import { query } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

// Login (Discord OAuth)
export const login = asyncHandler(async (req, res) => {
  const { userId, username } = req.body;

  if (!userId) {
    throw new AppError('userId is required', 400);
  }

  // Update last login
  await query(
    `UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
    [userId]
  );

  // Generate JWT token (optional, for admin dashboard)
  const token = jwt.sign(
    { userId, username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  logger.info(`User logged in: ${userId}`);

  res.json({
    success: true,
    token,
    user: { userId, username }
  });
});

// Validate session
export const validateSession = asyncHandler(async (req, res) => {
  const { token } = req.body;

  if (!token) {
    throw new AppError('Token is required', 400);
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  res.json({
    success: true,
    user: decoded
  });
});

export default { login, validateSession };
