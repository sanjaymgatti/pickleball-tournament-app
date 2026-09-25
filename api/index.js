// Vercel invokes this file's export as a (req, res) => {} request handler.
// An Express app is exactly that shape already, so no adapter is needed -
// vercel.json routes every request here, and src/app.js (shared with
// server.js, used for local dev / Render / a VPS) does the rest: API
// routes, static file serving, and the catch-all.
module.exports = require('../src/app');
