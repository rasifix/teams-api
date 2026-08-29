import { Router } from 'express';
import {
  getAllGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup
} from '../controllers/groupController';
import { importLocalStorageData } from '../controllers/importController';
import { authenticateToken } from '../middleware/auth';
import { authorizeGroupAccess, requireGroupRole } from '../middleware/groupAuth';

// Import nested route handlers
import membersRoutes from './membersRoutes';
import eventRoutes from './eventRoutes';
import shirtSetRoutes from './shirtSetRoutes';
import periodsRoutes from './periodsRoutes';
import playingModeRoutes from './playingModeRoutes';
import formationRoutes from './formationRoutes';

const router = Router();

// Group CRUD operations
router.get('/', authenticateToken, getAllGroups);
router.get('/:id', authenticateToken, authorizeGroupAccess, getGroupById);
router.post('/', authenticateToken, createGroup);
router.put('/:id', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin']), updateGroup);
router.delete('/:id', authenticateToken, authorizeGroupAccess, requireGroupRole(['admin']), deleteGroup);

// Import data from localStorage format (protected by group membership)
router.post('/:groupId/import', authenticateToken, authorizeGroupAccess, importLocalStorageData);

// Nested routes under groups - all protected by authentication and group membership
// All nested routes will have groupId available in req.params
router.use('/:groupId/members', authenticateToken, authorizeGroupAccess, (req, _res, next) => {
  // Add groupId to request for nested routes
  req.params.groupId = req.params.groupId;
  next();
}, membersRoutes);

router.use('/:groupId/events', authenticateToken, authorizeGroupAccess, (req, _res, next) => {
  req.params.groupId = req.params.groupId;
  next();
}, eventRoutes);

router.use('/:groupId/shirtsets', authenticateToken, authorizeGroupAccess, (req, _res, next) => {
  req.params.groupId = req.params.groupId;
  next();
}, shirtSetRoutes);

router.use('/:groupId/periods', authenticateToken, authorizeGroupAccess, (req, _res, next) => {
  req.params.groupId = req.params.groupId;
  next();
}, periodsRoutes);

router.use('/:groupId/playing-modes', authenticateToken, authorizeGroupAccess, (req, _res, next) => {
  req.params.groupId = req.params.groupId;
  next();
}, playingModeRoutes);

router.use('/:groupId/formations', authenticateToken, authorizeGroupAccess, (req, _res, next) => {
  req.params.groupId = req.params.groupId;
  next();
}, formationRoutes);

export default router;