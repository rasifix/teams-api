import { Router } from 'express';
import {
  getAllEvaluationsForMember,
  createEvaluation,
  updateEvaluation,
  deleteEvaluation
} from '../controllers/evaluationController';
import { requireGroupRole } from '../middleware/groupAuth';

const router = Router({ mergeParams: true });

// GET /api/groups/:groupId/members/:memberId/evaluations
router.get('/', requireGroupRole(['admin', 'trainer']), getAllEvaluationsForMember);

// POST /api/groups/:groupId/members/:memberId/evaluations
router.post('/', requireGroupRole(['admin', 'trainer']), createEvaluation);

// PUT /api/groups/:groupId/members/:memberId/evaluations/:evaluationId
router.put('/:evaluationId', requireGroupRole(['admin', 'trainer']), updateEvaluation);

// DELETE /api/groups/:groupId/members/:memberId/evaluations/:evaluationId
router.delete('/:evaluationId', requireGroupRole(['admin', 'trainer']), deleteEvaluation);

export default router;
