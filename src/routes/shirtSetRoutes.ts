import { Router } from 'express';
import {
  getShirtSets,
  getShirtSetById,
  createShirtSet,
  updateShirtSet,
  deleteShirtSet,
} from '../controllers/shirtSetController';
import { requireGroupRole } from '../middleware/groupAuth';

const router = Router({ mergeParams: true });

router.get('/', getShirtSets);
router.get('/:id', getShirtSetById);
router.post('/', requireGroupRole(['admin']), createShirtSet);
router.put('/:id', requireGroupRole(['admin']), updateShirtSet);
router.delete('/:id', requireGroupRole(['admin']), deleteShirtSet);

export default router;