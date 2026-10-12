import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { mongoConnection } from './database/connection';
import groupRoutes from './routes/groupRoutes';
import authRoutes from './routes/authRoutes';
import sfvCategoryRoutes from './routes/sfvCategoryRoutes';
import spondRoutes from './routes/spondRoutes';
import { AuthRequest } from './middleware/auth';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Access log: user, method + path, status. Auth middleware sets req.user later, so read it on finish.
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const user = (req as AuthRequest).user;
    const who = user ? `${user.id} <${user.email}>` : 'anonymous';
    const path = req.originalUrl.split('?')[0];
    console.log(
      `[access] ${new Date().toISOString()} user=${who} ${req.method} ${path} status=${res.statusCode} durationMs=${Date.now() - startedAt}`
    );
  });
  next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/api/sfv-categories', sfvCategoryRoutes);
app.use('/api/integrations/spond', spondRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/squads', groupRoutes);

// Health check
app.get('/health', async (_req, res) => {
  try {
    const dbHealth = await mongoConnection.healthCheck();
    res.json({ 
      status: 'ok', 
      message: 'Teams API is running',
      database: dbHealth
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      message: 'Teams API is running but database is unhealthy',
      error: error instanceof Error ? error.message : 'Unknown database error'
    });
  }
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server with database initialization
async function startServer() {
  try {
    // Connect to MongoDB first
    await mongoConnection.connect();
    
    // Start the Express server
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
      console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
      console.log(`🩺 Health check: http://localhost:${PORT}/health`);
      console.log('');
      console.log('Available endpoints:');
      console.log('  POST   /auth/register');
      console.log('  POST   /auth/login');
      console.log('  GET    /auth/me (protected)');
      console.log('  GET    /api/groups');
      console.log('  POST   /api/groups');
      console.log('  GET    /api/groups/:groupId/members?roles=player|trainer');
      console.log('  POST   /api/groups/:groupId/members');
      console.log('  GET    /api/groups/:groupId/members/:memberId/evaluations');
      console.log('  POST   /api/groups/:groupId/members/:memberId/evaluations');
      console.log('  PUT    /api/groups/:groupId/members/:memberId/evaluations/:evaluationId');
      console.log('  DELETE /api/groups/:groupId/members/:memberId/evaluations/:evaluationId');
      console.log('  GET    /api/groups/:groupId/events');
      console.log('  POST   /api/groups/:groupId/events');
      console.log('  GET    /api/groups/:groupId/shirtsets');
      console.log('  POST   /api/groups/:groupId/shirtsets');
      console.log('  GET    /api/groups/:groupId/periods');
      console.log('  POST   /api/groups/:groupId/periods');
      console.log('  PUT    /api/groups/:groupId/periods/:periodId');
      console.log('  DELETE /api/groups/:groupId/periods/:periodId');
      console.log('  POST   /api/groups/:groupId/spond/import');
      console.log('  POST   /api/integrations/spond/groups');
      console.log('  POST   /api/integrations/spond/snapshot');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
