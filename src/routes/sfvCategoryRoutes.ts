import { Router } from 'express';
import { getSfvCategories } from '../controllers/sfvCategoryController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, getSfvCategories);

export default router;
