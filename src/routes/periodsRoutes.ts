import { Router } from 'express';
import {
  getPeriods,
  createPeriod,
  updatePeriod,
  deletePeriod
} from '../controllers/periodController';

const router = Router({ mergeParams: true });

router.get('/', getPeriods);
router.post('/', createPeriod);
router.put('/:periodId', updatePeriod);
router.delete('/:periodId', deletePeriod);

export default router;