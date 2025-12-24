/**
 * Auth Routes
 * Sign up, login, profile
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Storage limits by plan (in bytes)
const STORAGE_LIMITS = {
  free: 16106127360,        // 15 GB
  plus: 107374182400,       // 100 GB
  pro: 536870912000,        // 500 GB
  unlimited: 1099511627776000  // ~1 PB (essentially unlimited)
};

/**
 * POST /api/auth/signup
 * Create new user account
 */
router.post('/signup', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Validation
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'Email, password, and username are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({ error: 'Username must be 3-50 characters' });
    }

    // Check if email or username exists
    const existing = await query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const result = await query(
      `INSERT INTO users (email, password_hash, username, plan, storage_limit)
       VALUES ($1, $2, $3, 'free', $4)
       RETURNING id, email, username, plan, storage_used, storage_limit, created_at`,
      [email.toLowerCase(), passwordHash, username.toLowerCase(), STORAGE_LIMITS.free]
    );

    const user = result.rows[0];

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
        storage_used: user.storage_used,
        storage_limit: user.storage_limit
      },
      token
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
        storage_used: user.storage_used,
        storage_limit: user.storage_limit
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, username, plan, storage_used, storage_limit, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Get song count
    const songCount = await query(
      'SELECT COUNT(*) FROM songs WHERE user_id = $1',
      [req.user.id]
    );

    // Get playlist count
    const playlistCount = await query(
      'SELECT COUNT(*) FROM playlists WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      ...user,
      song_count: parseInt(songCount.rows[0].count),
      playlist_count: parseInt(playlistCount.rows[0].count),
      storage_used_gb: (user.storage_used / 1073741824).toFixed(2),
      storage_limit_gb: (user.storage_limit / 1073741824).toFixed(0)
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * PUT /api/auth/plan
 * Upgrade user plan
 */
router.put('/plan', authenticateToken, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!['free', 'plus', 'pro', 'unlimited'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const result = await query(
      `UPDATE users 
       SET plan = $1, storage_limit = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, email, username, plan, storage_used, storage_limit`,
      [plan, STORAGE_LIMITS[plan], req.user.id]
    );

    res.json({
      message: `Plan updated to ${plan}`,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Plan update error:', error);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

module.exports = router;
