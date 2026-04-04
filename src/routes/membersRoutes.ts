import { Router } from 'express';
import {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  addGuardianToPlayer,
  deleteGuardianFromPlayer
} from '../controllers/membersController';
import evaluationRoutes from './evaluationRoutes';

const router = Router({ mergeParams: true });

// GET /api/groups/:groupId/members?role=player|trainer
router.get('/', getAllMembers);

// GET /api/groups/:groupId/members/:id
router.get('/:id', getMemberById);

// POST /api/groups/:groupId/members
router.post('/', createMember);

// PUT /api/groups/:groupId/members/:id
router.put('/:id', updateMember);

// POST /api/groups/:groupId/members/:id/guardians
router.post('/:id/guardians', addGuardianToPlayer);

// DELETE /api/groups/:groupId/members/:id/guardians/:guardianId
router.delete('/:id/guardians/:guardianId', deleteGuardianFromPlayer);

// DELETE /api/groups/:groupId/members/:id
router.delete('/:id', deleteMember);

// Nested evaluation routes for members
// /api/groups/:groupId/members/:memberId/evaluations
router.use('/:memberId/evaluations', evaluationRoutes);

export default router;