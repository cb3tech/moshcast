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
    version: '1.0.0',
    status: 'running',
    message: 'Your Music. Your Library. Everywhere.'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/upload', uploadRoutes);

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
  🎵 Moshcast API Server
  ━━━━━━━━━━━━━━━━━━━━━━
  Status:  Running
  Port:    ${PORT}
  Env:     ${process.env.NODE_ENV || 'development'}
  ━━━━━━━━━━━━━━━━━━━━━━
  `);
});

module.exports = app;
