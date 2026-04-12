import { Router } from 'express';
import {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  addGuardianToPlayer,
  deleteGuardianFromPlayer,
  revokeRoleFromMember,
} from '../controllers/membersController';
import evaluationRoutes from './evaluationRoutes';
import { requireGroupRole } from '../middleware/groupAuth';

const router = Router({ mergeParams: true });

// GET /api/groups/:groupId/members?roles=player|trainer
router.get('/', requireGroupRole(['admin', 'trainer', 'guardian']), getAllMembers);

// GET /api/groups/:groupId/members/:id
router.get('/:id', requireGroupRole(['admin', 'trainer', 'guardian']), getMemberById);

// POST /api/groups/:groupId/members
router.post('/', requireGroupRole(['admin', 'trainer']), createMember);

// PUT /api/groups/:groupId/members/:id
router.put('/:id', requireGroupRole(['admin', 'trainer']), updateMember);

// POST /api/groups/:groupId/members/:id/guardians
router.post('/:id/guardians', requireGroupRole(['admin', 'trainer']), addGuardianToPlayer);

// DELETE /api/groups/:groupId/members/:id/guardians/:guardianId
router.delete('/:id/guardians/:guardianId', requireGroupRole(['admin', 'trainer']), deleteGuardianFromPlayer);

// DELETE /api/groups/:groupId/members/:id/roles/:role
router.delete('/:id/roles/:role', requireGroupRole(['admin', 'trainer']), revokeRoleFromMember);

// DELETE /api/groups/:groupId/members/:id
router.delete('/:id', requireGroupRole(['admin', 'trainer']), deleteMember);

// Nested evaluation routes for members
// /api/groups/:groupId/members/:memberId/evaluations
router.use('/:memberId/evaluations', evaluationRoutes);

export default router;