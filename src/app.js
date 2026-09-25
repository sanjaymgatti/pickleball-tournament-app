require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const tournamentRoutes = require('./routes/tournaments');
const { router: categoryRoutes } = require('./routes/categories');
const { router: playerRoutes } = require('./routes/players');
const { router: teamRoutes } = require('./routes/teams');
const matchRoutes = require('./routes/matches');

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api', categoryRoutes); // /api/tournaments/:tid/categories, /api/categories/:id
app.use('/api', playerRoutes);   // /api/categories/:cid/players, /api/players/:id
app.use('/api', teamRoutes);     // /api/categories/:cid/teams, /api/teams/:id
app.use('/api', matchRoutes);    // /api/categories/:cid/generate-draws, matches, leaderboard

// Static frontend (public/index.html, dashboard.html, css, js). On Vercel,
// vercel.json routes every request into this same app, so this still
// handles static files there too - no separate static hosting setup needed.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback: any unknown non-API route serves the SPA-ish dashboard shell.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Basic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
