/**
 * Moshcast Backend - Entry Point
 * Your Music. Your Library. Everywhere.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import routes
const authRoutes = require('./routes/auth');
const libraryRoutes = require('./routes/library');
const playlistRoutes = require('./routes/playlists');
const uploadRoutes = require('./routes/upload');
const settingsRoutes = require('./routes/settings');
const feedsRoutes = require('./routes/feeds');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'Moshcast API',
    version: '1.1.0',
    status: 'running',
    message: 'Your Music. Your Library. Everywhere.',
    features: ['library', 'playlists', 'upload', 'settings', 'rss-feeds']
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/feeds', feedsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  🎵 Moshcast API Server v1.1.0
  ─────────────────────────────
  Status:  Running
  Port:    ${PORT}
  Env:     ${process.env.NODE_ENV || 'development'}
  ─────────────────────────────
  Routes:
  • /api/auth      - Authentication
  • /api/library   - Music library
  • /api/playlists - Playlist management
  • /api/upload    - File uploads
  • /api/settings  - User preferences
  • /api/feeds     - RSS news feeds
  ─────────────────────────────
  `);
});

module.exports = app;
