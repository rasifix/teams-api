import { Router } from 'express';
import {
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  upsertInvitations,
  updateInvitationStatus,
  upsertSelection,
} from '../controllers/eventController';
import { requireGroupRole } from '../middleware/groupAuth';

const router = Router({ mergeParams: true });

router.get('/', getAllEvents);
router.get('/:id', getEventById);
router.post('/', requireGroupRole(['admin', 'trainer']), createEvent);
router.put('/:id', requireGroupRole(['admin', 'trainer']), updateEvent);
router.delete('/:id', requireGroupRole(['admin', 'trainer']), deleteEvent);

// Special event routes
router.put('/:id/players', requireGroupRole(['admin', 'trainer']), upsertInvitations);
router.put('/:id/players/:player_id/status', requireGroupRole(['admin', 'trainer', 'guardian']), updateInvitationStatus);
router.put('/:id/selection', requireGroupRole(['admin', 'trainer']), upsertSelection);

export default router;
