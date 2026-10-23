import { Router } from 'express';
import {
  getAllGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup
} from '../controllers/groupController';
import {
  createBirthdayCalendarSubscription,
  getBirthdayCalendarSubscription,
  revokeBirthdayCalendarSubscription
} from '../controllers/birthdayCalendarController';
import { importSpondSnapshot } from '../controllers/spondImportController';
import { authenticateToken } from '../middleware/auth';
import { authorizeGroupAccess, requireGroupRole } from '../middleware/groupAuth';

// Import nested route handlers
import membersRoutes from './membersRoutes';
import shirtSetRoutes from './shirtSetRoutes';
import periodsRoutes from './periodsRoutes';
import playingModeRoutes from './playingModeRoutes';
import formationRoutes from './formationRoutes';
import activityRoutes from './activityRoutes';
import { getActivityAuditEvents } from '../controllers/activityEventController';

const router = Router({ mergeParams: true });

// Group CRUD operations
router.get('/', authenticateToken, getAllGroups);
router.get('/:id', authenticateToken, authorizeGroupAccess, getGroupById);
router.post('/', authenticateToken, createGroup);
router.put('/:id', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin']), updateGroup);
router.delete('/:id', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin']), deleteGroup);
router.get('/:id/birthday-calendar', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin', 'trainer']), getBirthdayCalendarSubscription);
router.post('/:id/birthday-calendar', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin', 'trainer']), createBirthdayCalendarSubscription);
router.delete('/:id/birthday-calendar', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin', 'trainer']), revokeBirthdayCalendarSubscription);

router.post('/:groupId/spond/import', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin', 'trainer']), importSpondSnapshot);
router.get('/:groupId/activity-events', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin']), getActivityAuditEvents);

// Nested routes under groups - all protected by authentication and group membership
// All nested routes will have groupId available in req.params
const scopedMiddleware = [authenticateToken, authorizeGroupAccess];
router.use('/:groupId/members', ...scopedMiddleware, membersRoutes);
router.use('/:groupId/activities', ...scopedMiddleware, activityRoutes);
router.use('/:groupId/shirtsets', ...scopedMiddleware, shirtSetRoutes);
router.use('/:groupId/periods', ...scopedMiddleware, periodsRoutes);
router.use('/:groupId/playing-modes', ...scopedMiddleware, playingModeRoutes);
router.use('/:groupId/match-formats', ...scopedMiddleware, playingModeRoutes);
router.use('/:groupId/formations', ...scopedMiddleware, formationRoutes);

export default router;
