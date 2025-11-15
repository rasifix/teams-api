import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extend Express Request type to include user information
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

// Get JWT secret from environment variable
const getJWTSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }
  return secret;
};

// Middleware to verify JWT token
export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    // Verify token
    const secret = getJWTSecret();
    const decoded = jwt.verify(token, secret) as {
      id: string;
      email: string;
    };

    // Add user info to request
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(403).json({ error: 'Invalid or expired token' });
    } else {
      res.status(500).json({ error: 'Authentication failed' });
    }
  }
};

// Optional authentication - doesn't fail if no token
export const optionalAuth = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const secret = getJWTSecret();
      const decoded = jwt.verify(token, secret) as {
        id: string;
        email: string;
      };
      req.user = decoded;
    }
    next();
  } catch (error) {
    // If token is invalid, just continue without user info
    next();
  }
};
