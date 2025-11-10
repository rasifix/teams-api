import { Router } from 'express';
import {
  getAllGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup
} from '../controllers/groupController';
import { importLocalStorageData } from '../controllers/importController';

// Import nested route handlers
import membersRoutes from './membersRoutes';
import eventRoutes from './eventRoutes';
import shirtSetRoutes from './shirtSetRoutes';

const router = Router();

// Group CRUD operations
router.get('/', getAllGroups);
router.get('/:id', getGroupById);
router.post('/', createGroup);
router.put('/:id', updateGroup);
router.delete('/:id', deleteGroup);

// Import data from localStorage format
router.post('/:groupId/import', importLocalStorageData);

// Nested routes under groups
// All nested routes will have groupId available in req.params
router.use('/:groupId/members', (req, _res, next) => {
  // Add groupId to request for nested routes
  req.params.groupId = req.params.groupId;
  next();
}, membersRoutes);

router.use('/:groupId/events', (req, _res, next) => {
  req.params.groupId = req.params.groupId;
  next();
}, eventRoutes);

router.use('/:groupId/shirtsets', (req, _res, next) => {
  req.params.groupId = req.params.groupId;
  next();
}, shirtSetRoutes);

export default router;