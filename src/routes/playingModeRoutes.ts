import { Router } from 'express';
import {
  getPlayingModes,
  createPlayingMode,
  updatePlayingMode,
  deletePlayingMode,
  setDefaultPlayingMode
} from '../controllers/playingModeController';
import { requireGroupRole } from '../middleware/groupAuth';

const router = Router({ mergeParams: true });

router.get('/', getPlayingModes);
router.post('/', requireGroupRole(['admin', 'trainer']), createPlayingMode);
router.put('/:playingModeId', requireGroupRole(['admin', 'trainer']), updatePlayingMode);
router.delete('/:playingModeId', requireGroupRole(['admin', 'trainer']), deletePlayingMode);
router.post('/:playingModeId/set-default', requireGroupRole(['admin', 'trainer']), setDefaultPlayingMode);

export default router;
