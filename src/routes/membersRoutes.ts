import { Router } from 'express';
import {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember
} from '../controllers/membersController';

const router = Router({ mergeParams: true });

// GET /api/groups/:groupId/members?role=player|trainer
router.get('/', getAllMembers);

// GET /api/groups/:groupId/members/:id
router.get('/:id', getMemberById);

// POST /api/groups/:groupId/members
router.post('/', createMember);

// PUT /api/groups/:groupId/members/:id
router.put('/:id', updateMember);

// DELETE /api/groups/:groupId/members/:id
router.delete('/:id', deleteMember);

export default router;