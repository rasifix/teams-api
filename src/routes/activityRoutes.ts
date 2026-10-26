import { Router } from 'express';
import {
  createActivity,
  deleteActivity,
  getActivities,
  getActivityById,
  markActivitySelectionSent,
  updateActivity,
  updateActivityStatus,
  updateActivityAttendance,
  updateActivityInvitation,
  updateActivityInvitations,
  updateActivitySelection,
  updateActivityTeams,
} from '../controllers/activityController';
import { requireGroupRole } from '../middleware/groupAuth';

const router = Router({ mergeParams: true });

router.get('/', getActivities);
router.post('/', requireGroupRole(['admin', 'trainer']), createActivity);
router.get('/:id', getActivityById);
router.put('/:id', requireGroupRole(['admin', 'trainer']), updateActivity);
router.delete('/:id', requireGroupRole(['admin', 'trainer']), deleteActivity);
router.put('/:id/status', requireGroupRole(['admin', 'trainer']), updateActivityStatus);
router.put('/:id/invitations', requireGroupRole(['admin', 'trainer']), updateActivityInvitations);
router.put('/:id/invitations/:playerId', requireGroupRole(['admin', 'trainer', 'guardian']), updateActivityInvitation);
router.put('/:id/teams', requireGroupRole(['admin', 'trainer']), updateActivityTeams);
router.put('/:id/selection', requireGroupRole(['admin', 'trainer']), updateActivitySelection);
router.put('/:id/selection/sent', requireGroupRole(['admin', 'trainer']), markActivitySelectionSent);
router.put('/:id/attendance', requireGroupRole(['admin', 'trainer']), updateActivityAttendance);

export default router;
