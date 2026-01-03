import { query } from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const getSystemStats = asyncHandler(async (req, res) => {
  const [users, tasks, campaigns, redemptions, points] = await Promise.all([
    query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_verified = true) as verified FROM users'),
    query(`SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'assigned') as assigned,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'verified') as verified
    FROM tasks`),
    query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'active') as active FROM campaigns`),
    query(`SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'approved') as approved
    FROM redemptions`),
    query('SELECT SUM(total_points) as total FROM users')
  ]);

  res.json({
    success: true,
    data: {
      users: users.rows[0],
      tasks: tasks.rows[0],
      campaigns: campaigns.rows[0],
      redemptions: redemptions.rows[0],
      totalPoints: parseInt(points.rows[0].total) || 0
    }
  });
});

export const getRecentLogs = asyncHandler(async (req, res) => {
  const { limit = 100 } = req.query;
  const result = await query(
    'SELECT * FROM system_logs ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  res.json({ success: true, count: result.rows.length, data: result.rows });
});

export const getAdminLogs = asyncHandler(async (req, res) => {
  const { limit = 100 } = req.query;
  const result = await query(
    'SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  res.json({ success: true, count: result.rows.length, data: result.rows });
});

export default { getSystemStats, getRecentLogs, getAdminLogs };
