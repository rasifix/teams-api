import { Router } from 'express';
import {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember
} from '../controllers/membersController';

const router = Router();

// GET /api/members?role=player|trainer
router.get('/', getAllMembers);

// GET /api/members/:id
router.get('/:id', getMemberById);

// POST /api/members
router.post('/', createMember);

// PUT /api/members/:id
router.put('/:id', updateMember);

// DELETE /api/members/:id
router.delete('/:id', deleteMember);

export default router;