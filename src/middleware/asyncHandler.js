// Express 4 does not automatically catch rejected promises thrown inside
// async route handlers - an unhandled rejection would otherwise just hang
// the request. Wrap every async handler with this.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
