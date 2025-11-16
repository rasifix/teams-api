import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { dataStore } from '../data/store';

/**
 * Middleware to authorize group access
 * Only authenticated trainers (trainers with a linked user) who are members of the group can access the endpoint
 * Returns HTTP 403 if authorization is not granted
 */
export const authorizeGroupAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // User must be authenticated
    if (!req.user?.id) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: 'Group ID is required' });
      return;
    }

    // Get the current user
    const user = await dataStore.getUserById(req.user.id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    console.log('Authorization Check:', {
      userId: req.user.id,
      userEmail: user.email,
      groupId,
    });

    // Get all trainers in the group
    const groupTrainers = await dataStore.getAllTrainers(groupId);

    // Find a trainer in this group that is linked to this user (by email)
    const isTrainerInGroup = groupTrainers.some(
      trainer => trainer.email && trainer.email.toLowerCase() === user.email.toLowerCase()
    );

    if (!isTrainerInGroup) {
      res.status(403).json({ error: 'You do not have access to this group' });
      return;
    }

    // Authorization successful, proceed to next middleware
    next();
  } catch (error) {
    console.error('Error authorizing group access:', error);
    res.status(500).json({ error: 'Authorization check failed' });
  }
};
