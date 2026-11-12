// Centralised error handling. Mounted last in the Express app.

// 404 handler for unknown routes.
export function notFound(req, _res, next) {
  next({ status: 404, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// Final error handler. Normalises plain objects thrown by notFound() and
// Error instances thrown by route handlers.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const message = err.message || 'Internal server error.';

  if (status >= 500) {
    // Log full detail server-side; do not leak internals to the client.
    console.error('[error]', message, err.details || '', err.stack || '');
  }

  res.status(status).json({
    success: false,
    error: message,
    ...(err.details ? { details: err.details } : {}),
  });
}
