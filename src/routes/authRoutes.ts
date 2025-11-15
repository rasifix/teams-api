import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// POST /api/auth/register - Register new user
router.post('/register', authController.register);

// POST /api/auth/login - Login user
router.post('/login', authController.login);

// GET /api/auth/me - Get current user info (protected)
router.get('/me', authenticateToken, authController.getMe);

// POST /api/auth/request-reset - Request password reset
router.post('/request-reset', authController.requestPasswordReset);

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', authController.resetPassword);

export default router;
