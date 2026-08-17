/** Helper kecil supaya route tidak penuh try/catch berulang. */

/** Bungkus handler async: error apa pun diteruskan ke error handler Express. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Error yang memang disengaja (validasi dsb), lengkap dengan status HTTP-nya. */
class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Error handler terakhir. Dipasang paling bawah di server.js. */
function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, err);
  res.status(status).json({ error: err.message || 'Terjadi kesalahan', code: err.code });
}

module.exports = { asyncHandler, HttpError, errorHandler };
