export function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars -- Express identifies handlers by arity.
export function errorHandler(err, _req, res, _next) {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.code ?? 'internal_error',
    message: status >= 500 ? 'Something went wrong.' : err.message,
  });
}
