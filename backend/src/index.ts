// backend/src/index.ts
// Main server entry point

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './utils/logger';
import { db } from './db';

// Middleware
import { corsOptions, helmetConfig, generalRateLimit } from './middleware/security';
import { 
  errorHandler, 
  notFoundHandler, 
  addRequestContext,
  handleUnhandledRejection,
  handleUncaughtException,
  setupGracefulShutdown
} from './middleware/error';

// Routes
import authRoutes from './routes/auth';
import modelsRoutes from './routes/models';
import browseRoutes from './routes/browse';
import artistsRoutes from './routes/artists';
import tablesRoutes from './routes/tables';
import ordersRoutes from './routes/orders';
import adminRoutes from './routes/admin';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================================================
// INITIALIZE APP
// ============================================================================

const app = express();

// ============================================================================
// GLOBAL MIDDLEWARE
// ============================================================================

// Security headers
app.use(helmetConfig);

// CORS
app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request context & logging
app.use(addRequestContext);

// Rate limiting
app.use(generalRateLimit);

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await db.query('SELECT 1');
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: NODE_ENV
    });
  } catch (error) {
    logger.error('Health check failed', { error });
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed'
    });
  }
});

// ============================================================================
// API ROUTES
// ============================================================================

const API_PREFIX = '/api';

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/models`, modelsRoutes);
app.use(`${API_PREFIX}/browse`, browseRoutes);
app.use(`${API_PREFIX}/artists`, artistsRoutes);
app.use(`${API_PREFIX}/tables`, tablesRoutes);
app.use(`${API_PREFIX}/orders`, ordersRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);

// API root
app.get(API_PREFIX, (req, res) => {
  res.json({
    name: 'Terrain Builder API',
    version: '1.0.0',
    endpoints: {
      auth: `${API_PREFIX}/auth`,
      models: `${API_PREFIX}/models`,
      browse: `${API_PREFIX}/browse`,
      artists: `${API_PREFIX}/artists`,
      tables: `${API_PREFIX}/tables`,
      orders: `${API_PREFIX}/orders`,
      admin: `${API_PREFIX}/admin`
    }
  });
});

// ============================================================================
// STATIC FILES (Uploads)
// ============================================================================

// Serve uploaded files
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
app.use('/uploads', express.static(UPLOAD_DIR));

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// ============================================================================
// PROCESS ERROR HANDLERS
// ============================================================================

handleUnhandledRejection();
handleUncaughtException();

// ============================================================================
// START SERVER
// ============================================================================

async function startServer() {
  try {
    // Test database connection
    await db.query('SELECT NOW()');
    logger.info('Database connected successfully');

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`, {
        environment: NODE_ENV,
        port: PORT,
        pid: process.pid
      });
      
      if (NODE_ENV === 'development') {
        logger.info(`📡 API available at http://localhost:${PORT}${API_PREFIX}`);
        logger.info(`🏥 Health check at http://localhost:${PORT}/health`);
      }
    });

    // Setup graceful shutdown
    setupGracefulShutdown(server);

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;