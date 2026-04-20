import { Router } from 'express';
import {
  getShirtSets,
  getShirtSetById,
  createShirtSet,
  updateShirtSet,
  updateShirtStatus,
  deleteShirtSet,
} from '../controllers/shirtSetController';
import { requireGroupRole } from '../middleware/groupAuth';

const router = Router({ mergeParams: true });

router.get('/', requireGroupRole(['admin', 'trainer']), getShirtSets);
router.get('/:id', requireGroupRole(['admin', 'trainer']), getShirtSetById);
router.post('/', requireGroupRole(['admin']), createShirtSet);
router.put('/:id', requireGroupRole(['admin']), updateShirtSet);
router.put('/:id/shirts/:shirtNumber/status', requireGroupRole(['admin']), updateShirtStatus);
router.delete('/:id', requireGroupRole(['admin']), deleteShirtSet);

export default router;