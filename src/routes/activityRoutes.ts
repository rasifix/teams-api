import { Router } from 'express';
import {
  createActivity,
  createActivityTask,
  deleteActivity,
  deleteActivityTask,
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
  updateActivityTask,
  signUpForActivityTask,
  withdrawFromActivityTask
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
router.post('/:id/tasks', requireGroupRole(['admin', 'trainer']), createActivityTask);
router.put('/:id/tasks/:taskId', requireGroupRole(['admin', 'trainer']), updateActivityTask);
router.delete('/:id/tasks/:taskId', requireGroupRole(['admin', 'trainer']), deleteActivityTask);
router.put('/:id/tasks/:taskId/signup', requireGroupRole(['admin', 'trainer', 'guardian']), signUpForActivityTask);
router.delete('/:id/tasks/:taskId/signup', requireGroupRole(['admin', 'trainer', 'guardian']), withdrawFromActivityTask);

export default router;
