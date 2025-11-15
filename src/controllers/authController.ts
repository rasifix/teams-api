import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { dataStore } from '../data/store';
import { User, PasswordReset } from '../types';
import { getNextSequence } from '../utils/sequence';
import { emailService } from '../services/emailService';

// Get JWT secret from environment variable
const getJWTSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }
  return secret;
};

// Get JWT expiration from environment or default to 24h
const getJWTExpiration = (): string => {
  return process.env.JWT_EXPIRATION || '24h';
};

// Generate JWT token
const generateToken = (user: User): string => {
  const secret = getJWTSecret();
  const expiration = getJWTExpiration();
  
  return jwt.sign(
    {
      id: user.id,
      email: user.email
    },
    secret,
    { expiresIn: expiration } as jwt.SignOptions
  );
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }
    
    // Validate password strength (at least 6 characters)
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }
    
    // Check if email already exists
    const existingUserByEmail = await dataStore.getUserByEmail(email.toLowerCase());
    if (existingUserByEmail) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Create user
    const newUser: User = {
      id: await getNextSequence('users'),
      email: email.toLowerCase(),
      password: hashedPassword
    };
    
    const createdUser = await dataStore.createUser(newUser);
    
    // Generate JWT token
    const token = generateToken(createdUser);
    
    // Return user info (without password) and token
    res.status(201).json({
      user: {
        id: createdUser.id,
        email: createdUser.email,
        createdAt: createdUser.createdAt
      },
      token
    });
  } catch (error) {
    console.error('Error registering user:', error);
    if (error instanceof Error && error.message.includes('duplicate key')) {
      res.status(409).json({ error: 'Email already exists' });
    } else {
      res.status(500).json({ error: 'Failed to register user' });
    }
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    
    // Find user by email
    const user = await dataStore.getUserByEmail(email.toLowerCase());
    
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    
    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    
    // Generate JWT token
    const token = generateToken(user);
    
    // Return user info (without password) and token
    res.json({
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      },
      token
    });
  } catch (error) {
    console.error('Error logging in user:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
};

// GET /api/auth/me - Get current user info (requires authentication)
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    // User info is already in req.user from auth middleware
    const userId = (req as any).user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    
    const user = await dataStore.getUserById(userId);
    
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    
    // Return user info without password
    res.json({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
};

export const requestPasswordReset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    
    // Validation
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }
    
    // Check if user exists
    const user = await dataStore.getUserByEmail(email.toLowerCase());
    
    // For security, always return success even if user doesn't exist
    // This prevents email enumeration attacks
    if (!user) {
      res.json({ 
        message: 'If an account exists with this email, you will receive a password reset link shortly.' 
      });
      return;
    }
    
    // Generate random reset token (32 bytes = 64 hex characters)
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Token expires in 1 hour
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);
    
    // Create password reset record
    const passwordReset: PasswordReset = {
      id: await getNextSequence('password-resets'),
      email: user.email,
      resetToken,
      expiresAt: expiresAt.toISOString(),
      used: false
    };
    
    await dataStore.createPasswordReset(passwordReset);
    
    // Send reset email
    try {
      await emailService.sendPasswordResetEmail({
        toEmail: user.email,
        resetToken
      });
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError);
      res.status(500).json({ error: 'Failed to send password reset email' });
      return;
    }
    
    res.json({ 
      message: 'If an account exists with this email, you will receive a password reset link shortly.' 
    });
  } catch (error) {
    console.error('Error requesting password reset:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, resetToken, newPassword } = req.body;
    
    // Validation
    if (!email || !resetToken || !newPassword) {
      res.status(400).json({ error: 'Email, reset token, and new password are required' });
      return;
    }
    
    // Validate password strength
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }
    
    // Find password reset record
    const passwordReset = await dataStore.getPasswordResetByToken(
      resetToken,
      email.toLowerCase()
    );
    
    if (!passwordReset) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }
    
    // Check if token is expired
    const now = new Date();
    const expiresAt = new Date(passwordReset.expiresAt);
    
    if (now > expiresAt) {
      res.status(400).json({ error: 'Reset token has expired' });
      return;
    }
    
    // Check if token was already used
    if (passwordReset.used) {
      res.status(400).json({ error: 'Reset token has already been used' });
      return;
    }
    
    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update user password
    const updated = await dataStore.updateUserPassword(email.toLowerCase(), hashedPassword);
    
    if (!updated) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    
    // Mark reset token as used
    await dataStore.markPasswordResetAsUsed(passwordReset.id);
    
    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};
