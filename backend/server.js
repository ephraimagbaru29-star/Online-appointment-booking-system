import { createApp } from './src/app.js';
import { config } from './src/config/env.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Online Appointment Booking System — API listening on port ${config.port}`);
  console.log(`  Frontend origin: ${config.frontendOrigin}`);
  console.log(`  Schedule timezone: ${config.scheduleTimezone}`);
  console.log(`  Supabase configured: ${Boolean(config.supabaseUrl)}`);
});

function shutdown(signal) {
  console.log(`\n[${signal}] shutting down...`);
  server.close(() => process.exit(0));
  // Force exit if the port won't release in time.
  setTimeout(() => process.exit(1), 5000).unref();
}

['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

export { app, server };
