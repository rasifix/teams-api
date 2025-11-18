import { Router } from 'express';
import {
  getAllEvaluationsForMember,
  createEvaluation,
  updateEvaluation
} from '../controllers/evaluationController';

const router = Router({ mergeParams: true });

// GET /api/groups/:groupId/members/:memberId/evaluations
router.get('/', getAllEvaluationsForMember);

// POST /api/groups/:groupId/members/:memberId/evaluations
router.post('/', createEvaluation);

// PUT /api/groups/:groupId/members/:memberId/evaluations/:evaluationId
router.put('/:evaluationId', updateEvaluation);

export default router;
