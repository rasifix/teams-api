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
import { getActivityHistory } from '../controllers/activityEventController';
import { activityIntent } from '../controllers/activityIntentController';

const router = Router({ mergeParams: true });

router.get('/', getActivities);
router.post('/', requireGroupRole(['admin', 'trainer']), createActivity);
router.get('/:id', getActivityById);
router.get('/:id/history', requireGroupRole(['admin']), getActivityHistory);
router.patch('/:id/details', requireGroupRole(['admin', 'trainer']), activityIntent('details'));
router.post('/:id/teams', requireGroupRole(['admin', 'trainer']), activityIntent('addTeam'));
router.patch('/:id/teams/:teamId/details', requireGroupRole(['admin', 'trainer']), activityIntent('teamDetails'));
router.put('/:id/teams/:teamId/responsible-person', requireGroupRole(['admin', 'trainer']), activityIntent('responsible'));
router.put('/:id/teams/:teamId/formation', requireGroupRole(['admin', 'trainer']), activityIntent('formation'));
router.put('/:id/teams/:teamId/shirts', requireGroupRole(['admin', 'trainer']), activityIntent('shirts'));
router.put('/:id/teams/:teamId/lineup', requireGroupRole(['admin', 'trainer']), activityIntent('lineup'));
router.post('/:id/teams/:teamId/selection-changes', requireGroupRole(['admin', 'trainer']), activityIntent('selection'));
router.post('/:id/invitations', requireGroupRole(['admin', 'trainer']), activityIntent('addInvitations'));
router.delete('/:id/invitations/:playerId', requireGroupRole(['admin', 'trainer']), activityIntent('removeInvitation'));
router.patch('/:id/attendance', requireGroupRole(['admin', 'trainer']), activityIntent('attendance'));
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
