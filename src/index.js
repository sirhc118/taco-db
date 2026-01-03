import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

// Config
dotenv.config();

// Routes
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import taskRoutes from './routes/task.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import pointRoutes from './routes/point.routes.js';
import redemptionRoutes from './routes/redemption.routes.js';
import predictionRoutes from './routes/prediction.routes.js';
import adminRoutes from './routes/admin.routes.js';
import healthRoutes from './routes/health.routes.js';

// Middleware
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

// Cron Jobs
import { startCronJobs } from './cron/index.js';

const app = express();
const PORT = process.env.PORT || 5000;
const API_VERSION = process.env.API_VERSION || 'v1';

// ============================================
// Middleware Setup
// ============================================

// Security
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://auth.taco.buzz']
    : '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15분
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 최대 100 요청
  message: 'Too many requests from this IP, please try again later.'
});
app.use(`/api/${API_VERSION}/`, limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ============================================
// Routes
// ============================================

// Health check (no auth required)
app.use('/health', healthRoutes);

// API routes
const apiRouter = express.Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/tasks', taskRoutes);
apiRouter.use('/campaigns', campaignRoutes);
apiRouter.use('/points', pointRoutes);
apiRouter.use('/redemptions', redemptionRoutes);
apiRouter.use('/predictions', predictionRoutes);
apiRouter.use('/admin', adminRoutes);

app.use(`/api/${API_VERSION}`, apiRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'TACO Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      api: `/api/${API_VERSION}`,
      docs: `/api/${API_VERSION}/docs`
    }
  });
});

// ============================================
// Error Handling
// ============================================

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use(errorHandler);

// ============================================
// Server Start
// ============================================

const server = app.listen(PORT, () => {
  logger.info(`🚀 TACO Backend API server running on port ${PORT}`);
  logger.info(`📡 API endpoint: http://localhost:${PORT}/api/${API_VERSION}`);
  logger.info(`🏥 Health check: http://localhost:${PORT}/health`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start cron jobs
  startCronJobs();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

export default app;
