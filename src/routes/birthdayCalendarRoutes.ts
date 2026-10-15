import { Router } from 'express';
import { getBirthdayCalendarFeed } from '../controllers/birthdayCalendarController';

const router = Router();

router.get('/:token.ics', getBirthdayCalendarFeed);

export default router;
