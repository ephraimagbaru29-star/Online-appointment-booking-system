import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, ok, httpError, isValidDate } from '../utils/http.js';
import { getAvailableSlots } from '../services/bookingEngine.js';
import { tz } from '../utils/time.js';

const router = Router();

// GET /api/slots?serviceId=&providerId=&date=YYYY-MM-DD
// Returns the available (free) time slots for booking that service with that
// provider on that date, computed from working hours minus breaks and existing
// active appointments. Times are returned in the configured schedule time zone.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { serviceId, providerId, date } = req.query;
  if (!serviceId) throw httpError(400, 'serviceId is required.');
  if (!providerId) throw httpError(400, 'providerId is required.');
  if (!isValidDate(date)) throw httpError(400, 'date must be a valid YYYY-MM-DD value.');
  // No past dates: reject dates strictly before today (in schedule tz).
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const selected = new Date(`${date}T00:00:00`);
  if (selected < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    throw httpError(400, 'Cannot view slots for a past date.');
  }

  const slots = await getAvailableSlots({ providerId: String(providerId), serviceId: String(serviceId), date: String(date) });
  ok(res, { date, timezone: tz, slots });
}));

export default router;
