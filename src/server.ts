import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { mongoConnection } from './database/connection';
import groupRoutes from './routes/groupRoutes';
import authRoutes from './routes/authRoutes';
import sfvCategoryRoutes from './routes/sfvCategoryRoutes';
import spondRoutes from './routes/spondRoutes';
import birthdayCalendarRoutes from './routes/birthdayCalendarRoutes';
import { runActivityEventMigration } from './controllers/activityMigrationController';
import { AuthRequest } from './middleware/auth';
import {
  getActivityEventSourcingMetrics,
  renderActivityEventSourcingMetrics
} from './domain/activityEventSourcingMetrics';

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());

// Access log: user, method + path, status. Auth middleware sets req.user later, so read it on finish.
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const user = (req as AuthRequest).user;
    const who = user ? `${user.id} <${user.email}>` : 'anonymous';
    const path = req.originalUrl
      .split('?')[0]
      .replace(/^\/api\/birthday-calendars\/[^/]+\.ics$/, '/api/birthday-calendars/[redacted].ics');
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
app.use('/api/birthday-calendars', birthdayCalendarRoutes);
app.use('/api/squads', groupRoutes);

// Temporary migration endpoint. Remove this route after the production migration.
app.post('/internal/migrations/activity-events', runActivityEventMigration);

// Health check
app.get('/health', async (_req, res) => {
  try {
    const dbHealth = await mongoConnection.healthCheck();
    res.json({ 
      status: 'ok', 
      message: 'Teams API is running',
      database: dbHealth,
      activityEventSourcing: {
        enabled: process.env.ACTIVITY_EVENT_SOURCING_ENABLED === 'true',
        metrics: getActivityEventSourcingMetrics()
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      message: 'Teams API is running but database is unhealthy',
      error: error instanceof Error ? error.message : 'Unknown database error'
    });
  }
});

// Local, process-memory metrics only. No external collector or persistence is used.
app.get('/metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4').send(
    renderActivityEventSourcingMetrics(process.env.ACTIVITY_EVENT_SOURCING_ENABLED === 'true')
  );
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
      console.log(`🧪 Activity event sourcing: ${process.env.ACTIVITY_EVENT_SOURCING_ENABLED === 'true' ? 'ENABLED' : 'disabled'}`);
      console.log('');
      console.log('Available endpoints:');
      console.log('  POST   /auth/register');
      console.log('  POST   /auth/login');
      console.log('  POST   /auth/request-reset');
      console.log('  POST   /auth/reset-password');
      console.log('  GET    /auth/me (protected)');
      console.log('  GET    /api/sfv-categories');
      console.log('  GET    /api/squads');
      console.log('  POST   /api/squads');
      console.log('  GET    /api/squads/:squadId');
      console.log('  PUT    /api/squads/:squadId');
      console.log('  DELETE /api/squads/:squadId');
      console.log('  GET    /api/squads/:squadId/birthday-calendar');
      console.log('  POST   /api/squads/:squadId/birthday-calendar');
      console.log('  DELETE /api/squads/:squadId/birthday-calendar');
      console.log('  GET    /api/squads/:squadId/members?roles=player|trainer');
      console.log('  POST   /api/squads/:squadId/members');
      console.log('  GET    /api/squads/:squadId/members/:id');
      console.log('  PUT    /api/squads/:squadId/members/:id');
      console.log('  DELETE /api/squads/:squadId/members/:id');
      console.log('  POST   /api/squads/:squadId/members/:id/guardians');
      console.log('  DELETE /api/squads/:squadId/members/:id/guardians/:guardianId');
      console.log('  DELETE /api/squads/:squadId/members/:id/roles/:role');
      console.log('  GET    /api/squads/:squadId/members/:memberId/evaluations');
      console.log('  POST   /api/squads/:squadId/members/:memberId/evaluations');
      console.log('  PUT    /api/squads/:squadId/members/:memberId/evaluations/:evaluationId');
      console.log('  DELETE /api/squads/:squadId/members/:memberId/evaluations/:evaluationId');
      console.log('  GET    /api/squads/:squadId/activities');
      console.log('  POST   /api/squads/:squadId/activities');
      console.log('  GET    /api/squads/:squadId/activities/:id');
      console.log('  PUT    /api/squads/:squadId/activities/:id');
      console.log('  DELETE /api/squads/:squadId/activities/:id');
      console.log('  PUT    /api/squads/:squadId/activities/:id/status');
      console.log('  PUT    /api/squads/:squadId/activities/:id/invitations/:playerId');
      console.log('  PUT    /api/squads/:squadId/activities/:id/teams');
      console.log('  PUT    /api/squads/:squadId/activities/:id/selection');
      console.log('  PUT    /api/squads/:squadId/activities/:id/selection/sent');
      console.log('  PUT    /api/squads/:squadId/activities/:id/attendance');
      console.log('  GET    /api/squads/:squadId/activity-events (admin)');
      console.log('  GET    /api/squads/:squadId/shirtsets');
      console.log('  POST   /api/squads/:squadId/shirtsets');
      console.log('  GET    /api/squads/:squadId/shirtsets/:id');
      console.log('  PUT    /api/squads/:squadId/shirtsets/:id');
      console.log('  DELETE /api/squads/:squadId/shirtsets/:id');
      console.log('  GET    /api/squads/:squadId/periods');
      console.log('  POST   /api/squads/:squadId/periods');
      console.log('  PUT    /api/squads/:squadId/periods/:periodId');
      console.log('  DELETE /api/squads/:squadId/periods/:periodId');
      console.log('  GET    /api/squads/:squadId/playing-modes');
      console.log('  POST   /api/squads/:squadId/playing-modes');
      console.log('  PUT    /api/squads/:squadId/playing-modes/:playingModeId');
      console.log('  DELETE /api/squads/:squadId/playing-modes/:playingModeId');
      console.log('  POST   /api/squads/:squadId/playing-modes/:playingModeId/set-default');
      console.log('  GET    /api/squads/:squadId/formations');
      console.log('  POST   /api/squads/:squadId/formations');
      console.log('  PUT    /api/squads/:squadId/formations/:formationId');
      console.log('  DELETE /api/squads/:squadId/formations/:formationId');
      console.log('  POST   /api/squads/:squadId/spond/import');
      console.log('  POST   /api/integrations/spond/groups');
      console.log('  POST   /api/integrations/spond/snapshot');
      console.log('  GET    /api/birthday-calendars/:token.ics');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
