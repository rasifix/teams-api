import { Router } from 'express';
import {
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  upsertInvitations,
  updateInvitationStatus,
  upsertSelection
} from '../controllers/eventController';

const router = Router();

router.get('/', getAllEvents);
router.get('/:id', getEventById);
router.post('/', createEvent);
router.put('/:id', updateEvent);
router.delete('/:id', deleteEvent);

// Special event routes
router.put('/:id/players', upsertInvitations);
router.put('/:id/players/:player_id/status', updateInvitationStatus);
router.put('/:id/selection', upsertSelection);

export default router;
