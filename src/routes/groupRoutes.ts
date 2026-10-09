import { Router } from 'express';
import {
  getAllGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup
} from '../controllers/groupController';
import { importLocalStorageData } from '../controllers/importController';
import { authenticateToken } from '../middleware/auth';
import { authorizeGroupAccess, requireGroupRole } from '../middleware/groupAuth';

// Import nested route handlers
import membersRoutes from './membersRoutes';
import eventRoutes from './eventRoutes';
import shirtSetRoutes from './shirtSetRoutes';
import periodsRoutes from './periodsRoutes';
import playingModeRoutes from './playingModeRoutes';
import formationRoutes from './formationRoutes';
import activityRoutes from './activityRoutes';

const router = Router({ mergeParams: true });

// Group CRUD operations
router.get('/', authenticateToken, getAllGroups);
router.get('/:id', authenticateToken, authorizeGroupAccess, getGroupById);
router.post('/', authenticateToken, createGroup);
router.put('/:id', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin']), updateGroup);
router.delete('/:id', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin']), deleteGroup);

// Import data from localStorage format (protected by group membership)
router.post('/:groupId/import', authenticateToken, authorizeGroupAccess, importLocalStorageData);

// Nested routes under groups - all protected by authentication and group membership
// All nested routes will have groupId available in req.params
const scopedMiddleware = [authenticateToken, authorizeGroupAccess];
router.use('/:groupId/members', ...scopedMiddleware, membersRoutes);
router.use('/:groupId/events', ...scopedMiddleware, eventRoutes);
router.use('/:groupId/activities', ...scopedMiddleware, activityRoutes);
router.use('/:groupId/shirtsets', ...scopedMiddleware, shirtSetRoutes);
router.use('/:groupId/periods', ...scopedMiddleware, periodsRoutes);
router.use('/:groupId/playing-modes', ...scopedMiddleware, playingModeRoutes);
router.use('/:groupId/match-formats', ...scopedMiddleware, playingModeRoutes);
router.use('/:groupId/formations', ...scopedMiddleware, formationRoutes);

export default router;