import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import apiRoutes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // Security headers (proposal 11: reliability & security).
  app.use(helmet({ contentSecurityPolicy: false }));

  // Body parsing.
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true }));

  // CORS restricted to the approved frontend origin (proposal section 8).
  const allow = [config.frontendOrigin];
  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin/no-origin (server-to-server, curl) requests.
        if (!origin || allow.includes(origin)) return cb(null, true);
        return cb(new Error('CORS blocked: origin not allowed.'));
      },
      credentials: true,
    })
  );

  // Lightweight request logger.
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
    next();
  });

  // Health check — does not require Supabase, used for uptime checks and the
  // verification step.
  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      status: 'ok',
      time: new Date().toISOString(),
      supabaseConfigured: Boolean(config.supabaseUrl),
      scheduleTimezone: config.scheduleTimezone,
    });
  });

  // API routes.
  app.use('/api', apiRoutes);

  // Serve the static frontend (proposal: frontend hosting; we serve it from
  // the same Express host for a simple, single-process deployment).
  const frontendDir = path.resolve(__dirname, '..', '..', 'frontend');
  app.use(express.static(frontendDir));
  // SPA-friendly fallback for known page routes.
  app.get(/^\/(index|customer\/dashboard|customer\/book|staff\/dashboard|staff\/services|staff\/availability)$/, (_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
