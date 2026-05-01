import { Router } from 'express';
import { liveness, readiness, metrics } from './health.controller';

const router = Router();

router.get('/', liveness);
router.get('/ready', readiness);
router.get('/metrics', metrics);

export default router;
