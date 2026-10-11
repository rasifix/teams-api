import { Router } from 'express';
import { proxySpondGroups, proxySpondSnapshot } from '../controllers/spondController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.post('/groups', authenticateToken, proxySpondGroups);
router.post('/snapshot', authenticateToken, proxySpondSnapshot);

export default router;
