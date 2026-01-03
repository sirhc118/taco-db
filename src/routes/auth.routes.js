import express from 'express';
import { login, validateSession } from '../controllers/auth.controller.js';

const router = express.Router();

// Discord OAuth callback handler
router.post('/login', login);

// Validate session
router.post('/validate', validateSession);

export default router;
