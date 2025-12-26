/**
 * Settings Routes
 * User preferences management
 */

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Default settings for new users
const DEFAULT_SETTINGS = {
  playback_quality: 'high',
  crossfade_seconds: 0,
  gapless_enabled: true,
  normalize_volume: false,
  cache_limit_mb: 1000,
  rss_refresh_minutes: 60,
  rss_max_articles: 50,
  theme: 'dark',
  profile_public: false,
  show_listening_activity: false,
  playlist_default_public: false
};

/**
 * GET /api/settings
 * Get user settings (creates defaults if none exist)
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Try to get existing settings
    let result = await query(
      'SELECT * FROM user_settings WHERE user_id = $1',
      [req.user.id]
    );

    // If no settings exist, create defaults
    if (result.rows.length === 0) {
      result = await query(`
        INSERT INTO user_settings (user_id)
        VALUES ($1)
        RETURNING *
      `, [req.user.id]);
    }

    const settings = result.rows[0];
    
    // Remove user_id from response
    delete settings.user_id;

    res.json(settings);

  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * PUT /api/settings
 * Update user settings
 */
router.put('/', authenticateToken, async (req, res) => {
  try {
    const {
      playback_quality,
      crossfade_seconds,
      gapless_enabled,
      normalize_volume,
      cache_limit_mb,
      rss_refresh_minutes,
      rss_max_articles,
      theme,
      profile_public,
      show_listening_activity,
      playlist_default_public
    } = req.body;

    // Validate playback_quality
    if (playback_quality && !['low', 'high', 'original'].includes(playback_quality)) {
      return res.status(400).json({ error: 'Invalid playback_quality. Use: low, high, original' });
    }

    // Validate crossfade_seconds (0-12)
    if (crossfade_seconds !== undefined && (crossfade_seconds < 0 || crossfade_seconds > 12)) {
      return res.status(400).json({ error: 'crossfade_seconds must be 0-12' });
    }

    // Validate cache_limit_mb (100-5000)
    if (cache_limit_mb !== undefined && (cache_limit_mb < 100 || cache_limit_mb > 5000)) {
      return res.status(400).json({ error: 'cache_limit_mb must be 100-5000' });
    }

    // Validate rss_refresh_minutes (15-1440)
    if (rss_refresh_minutes !== undefined && (rss_refresh_minutes < 15 || rss_refresh_minutes > 1440)) {
      return res.status(400).json({ error: 'rss_refresh_minutes must be 15-1440' });
    }

    // Validate rss_max_articles (10-200)
    if (rss_max_articles !== undefined && (rss_max_articles < 10 || rss_max_articles > 200)) {
      return res.status(400).json({ error: 'rss_max_articles must be 10-200' });
    }

    // Validate theme
    if (theme && !['dark', 'light', 'system'].includes(theme)) {
      return res.status(400).json({ error: 'Invalid theme. Use: dark, light, system' });
    }

    // Upsert settings
    const result = await query(`
      INSERT INTO user_settings (
        user_id, playback_quality, crossfade_seconds, gapless_enabled,
        normalize_volume, cache_limit_mb, rss_refresh_minutes, rss_max_articles,
        theme, profile_public, show_listening_activity, playlist_default_public,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        playback_quality = COALESCE($2, user_settings.playback_quality),
        crossfade_seconds = COALESCE($3, user_settings.crossfade_seconds),
        gapless_enabled = COALESCE($4, user_settings.gapless_enabled),
        normalize_volume = COALESCE($5, user_settings.normalize_volume),
        cache_limit_mb = COALESCE($6, user_settings.cache_limit_mb),
        rss_refresh_minutes = COALESCE($7, user_settings.rss_refresh_minutes),
        rss_max_articles = COALESCE($8, user_settings.rss_max_articles),
        theme = COALESCE($9, user_settings.theme),
        profile_public = COALESCE($10, user_settings.profile_public),
        show_listening_activity = COALESCE($11, user_settings.show_listening_activity),
        playlist_default_public = COALESCE($12, user_settings.playlist_default_public),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      req.user.id,
      playback_quality,
      crossfade_seconds,
      gapless_enabled,
      normalize_volume,
      cache_limit_mb,
      rss_refresh_minutes,
      rss_max_articles,
      theme,
      profile_public,
      show_listening_activity,
      playlist_default_public
    ]);

    const settings = result.rows[0];
    delete settings.user_id;

    res.json({
      message: 'Settings updated',
      settings
    });

  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * POST /api/settings/reset
 * Reset settings to defaults
 */
router.post('/reset', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      INSERT INTO user_settings (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO UPDATE SET
        playback_quality = 'high',
        crossfade_seconds = 0,
        gapless_enabled = true,
        normalize_volume = false,
        cache_limit_mb = 1000,
        rss_refresh_minutes = 60,
        rss_max_articles = 50,
        theme = 'dark',
        profile_public = false,
        show_listening_activity = false,
        playlist_default_public = false,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [req.user.id]);

    const settings = result.rows[0];
    delete settings.user_id;

    res.json({
      message: 'Settings reset to defaults',
      settings
    });

  } catch (error) {
    console.error('Reset settings error:', error);
    res.status(500).json({ error: 'Failed to reset settings' });
  }
});

module.exports = router;
