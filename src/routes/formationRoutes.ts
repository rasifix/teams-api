import { Router } from 'express';
import {
  getFormations,
  createFormation,
  updateFormation,
  deleteFormation
} from '../controllers/formationController';
import { requireGroupRole } from '../middleware/groupAuth';

const router = Router({ mergeParams: true });

router.get('/', getFormations);
router.post('/', requireGroupRole(['admin', 'trainer']), createFormation);
router.put('/:formationId', requireGroupRole(['admin', 'trainer']), updateFormation);
router.delete('/:formationId', requireGroupRole(['admin', 'trainer']), deleteFormation);

export default router;
