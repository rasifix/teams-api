import { Router } from 'express';
import {
  getPeriods,
  createPeriod,
  updatePeriod,
  deletePeriod
} from '../controllers/periodController';
import { requireGroupRole } from '../middleware/groupAuth';

const router = Router({ mergeParams: true });

router.get('/', getPeriods);
router.post('/', requireGroupRole(['admin']), createPeriod);
router.put('/:periodId', requireGroupRole(['admin']), updatePeriod);
router.delete('/:periodId', requireGroupRole(['admin']), deletePeriod);

export default router;