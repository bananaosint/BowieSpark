export function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars -- Express identifies handlers by arity.
export function errorHandler(err, _req, res, _next) {
  const status = err.status ?? 500;

  // 5xx: log everything, tell the client nothing. err.code on a server fault
  // is usually an internal identifier (a Prisma error code, an ECONNREFUSED)
  // and describes our infrastructure, so it does not go over the wire.
  if (status >= 500) {
    console.error(err);
    return res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' });
  }

  // 4xx: the client caused it, so it gets a useful code and the real message.
  res.status(status).json({
    error: err.code ?? 'request_error',
    message: err.message || 'Bad request.',
  });
}
