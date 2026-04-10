import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { dataStore } from '../data/store';
import { GroupRole } from '../types';

type GroupAccessContext = {
  memberId: string;
  groupId: string;
  roles: GroupRole[];
};

export interface GroupAuthRequest extends AuthRequest {
  groupAccess?: GroupAccessContext;
}

const resolveGroupId = (req: GroupAuthRequest): string | undefined => req.params.groupId || req.params.id;

/**
 * Middleware to authorize group access
 * Only authenticated trainers (trainers with a linked user) who are members of the group can access the endpoint
 * Returns HTTP 403 if authorization is not granted
 */
export const authorizeGroupAccess = async (
  req: GroupAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // User must be authenticated
    if (!req.user?.id) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const groupId = resolveGroupId(req);
    if (!groupId) {
      res.status(400).json({ error: 'Group ID is required' });
      return;
    }

    const groupAccess = await dataStore.getUserGroupAccess(req.user.id, groupId);
    if (!groupAccess) {
      res.status(403).json({ error: 'You do not have access to this group' });
      return;
    }

    req.groupAccess = {
      ...groupAccess,
      groupId
    };

    // Authorization successful, proceed to next middleware
    next();
  } catch (error) {
    console.error('Error authorizing group access:', error);
    res.status(500).json({ error: 'Authorization check failed' });
  }
};

export const requireGroupRole = (allowedRoles: GroupRole[]) => {
  return (req: GroupAuthRequest, res: Response, next: NextFunction): void => {
    const groupRoles = req.groupAccess?.roles ?? [];
    const hasRequiredRole = groupRoles.some(role => allowedRoles.includes(role));

    if (!hasRequiredRole) {
      res.status(403).json({
        error: 'Insufficient permissions for this operation',
        requiredRoles: allowedRoles
      });
      return;
    }

    next();
  };
};
