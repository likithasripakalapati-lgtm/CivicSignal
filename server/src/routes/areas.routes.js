import { Router } from 'express';
import { getAreaImpact, getAreas } from '../controllers/areas.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.get('/', getAreas);
router.get('/:id/impact', authenticate, getAreaImpact);

export default router;
