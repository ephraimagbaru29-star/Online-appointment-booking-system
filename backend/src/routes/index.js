import { Router } from 'express';
import authRoutes from './auth.js';
import profileRoutes from './profile.js';
import servicesRoutes from './services.js';
import availabilityRoutes from './availability.js';
import slotsRoutes from './slots.js';
import appointmentsRoutes from './appointments.js';
import staffRoutes from './staff.js';

// Aggregates all /api sub-routers.
const router = Router();

router.use('/auth', authRoutes);
router.use('/profile', profileRoutes);
router.use('/services', servicesRoutes);
router.use('/availability', availabilityRoutes);
router.use('/slots', slotsRoutes);
router.use('/appointments', appointmentsRoutes);
router.use('/staff', staffRoutes);

export default router;
