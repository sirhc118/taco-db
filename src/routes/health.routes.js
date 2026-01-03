import express from 'express';
import { query } from '../config/database.js';

const router = express.Router();

// Health check endpoint
router.get('/', async (req, res) => {
  try {
    // Database connection check
    const dbCheck = await query('SELECT NOW()');

    res.status(200).json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'taco-backend',
      version: '1.0.0',
      database: {
        connected: true,
        timestamp: dbCheck.rows[0].now
      },
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      database: {
        connected: false
      }
    });
  }
});

// Detailed health check
router.get('/detailed', async (req, res) => {
  try {
    // Database stats
    const userCount = await query('SELECT COUNT(*) FROM users');
    const activeTasksCount = await query(
      "SELECT COUNT(*) FROM tasks WHERE status IN ('assigned', 'completed')"
    );
    const activeCampaignsCount = await query(
      "SELECT COUNT(*) FROM campaigns WHERE status = 'active'"
    );

    res.status(200).json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      stats: {
        totalUsers: parseInt(userCount.rows[0].count),
        activeTasks: parseInt(activeTasksCount.rows[0].count),
        activeCampaigns: parseInt(activeCampaignsCount.rows[0].count)
      },
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

export default router;
