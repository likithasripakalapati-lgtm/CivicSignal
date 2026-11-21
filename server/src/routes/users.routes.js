import { Router } from 'express';
import { getCurrentUser, patchPreferences } from '../controllers/users.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { verifyCsrf } from '../middleware/verifyCsrf.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { preferencesSchema } from '../schemas/user.schemas.js';

const router = Router();

router.get('/me', authenticate, getCurrentUser);
router.patch('/preferences', authenticate, verifyCsrf, validateRequest(preferencesSchema), patchPreferences);

export default router;
