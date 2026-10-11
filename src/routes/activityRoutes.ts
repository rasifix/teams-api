import { Router } from 'express';
import {
  createActivity,
  deleteActivity,
  getActivities,
  getActivityById,
  getActivityTeams,
  markActivitySelectionSent,
  updateActivity,
  updateActivityAttendance,
  updateActivityAttendanceForPerson,
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
router.put('/:id/invitations', requireGroupRole(['admin', 'trainer']), updateActivityInvitations);
router.put('/:id/invitations/:playerId', requireGroupRole(['admin', 'trainer', 'guardian']), updateActivityInvitation);
router.get('/:id/teams', getActivityTeams);
router.put('/:id/teams', requireGroupRole(['admin', 'trainer']), updateActivityTeams);
router.put('/:id/selection', requireGroupRole(['admin', 'trainer']), updateActivitySelection);
router.put('/:id/selection/sent', requireGroupRole(['admin', 'trainer']), markActivitySelectionSent);
router.put('/:id/attendance', requireGroupRole(['admin', 'trainer']), updateActivityAttendance);
router.put('/:id/attendance/:personId', requireGroupRole(['admin', 'trainer']), updateActivityAttendanceForPerson);

export default router;
