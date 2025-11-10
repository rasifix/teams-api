import { Router } from 'express';
import {
  getShirtSets,
  getShirtSetById,
  createShirtSet,
  updateShirtSet,
  deleteShirtSet,
} from '../controllers/shirtSetController';

const router = Router();

router.get('/', getShirtSets);
router.get('/:id', getShirtSetById);
router.post('/', createShirtSet);
router.put('/:id', updateShirtSet);
router.delete('/:id', deleteShirtSet);

export default router;