import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { mongoConnection } from './database/connection';
import groupRoutes from './routes/groupRoutes';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/groups', groupRoutes);

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
      console.log('  GET    /api/groups');
      console.log('  POST   /api/groups');
      console.log('  GET    /api/groups/:groupId/members?role=player|trainer');
      console.log('  POST   /api/groups/:groupId/members');
      console.log('  GET    /api/groups/:groupId/events');
      console.log('  POST   /api/groups/:groupId/events');
      console.log('  GET    /api/groups/:groupId/shirtsets');
      console.log('  POST   /api/groups/:groupId/shirtsets');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
