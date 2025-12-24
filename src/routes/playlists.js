/**
 * Playlist Routes
 * Create, manage, share playlists
 */

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Generate short share code
const generateShareCode = () => {
  return uuidv4().substring(0, 8).toUpperCase();
};

/**
 * GET /api/playlists
 * Get user's playlists
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT p.id, p.name, p.description, p.is_public, p.share_code,
             p.created_at, p.updated_at,
             COUNT(ps.id) as song_count,
             COALESCE(SUM(s.duration), 0) as total_duration
      FROM playlists p
      LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
      LEFT JOIN songs s ON ps.song_id = s.id
      WHERE p.user_id = $1
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `, [req.user.id]);

    res.json({
      count: result.rows.length,
      playlists: result.rows
    });

  } catch (error) {
    console.error('Playlists fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

/**
 * POST /api/playlists
 * Create new playlist
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Playlist name is required' });
    }

    const shareCode = generateShareCode();

    const result = await query(`
      INSERT INTO playlists (user_id, name, description, share_code)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.user.id, name.trim(), description || null, shareCode]);

    res.status(201).json({
      message: 'Playlist created',
      playlist: result.rows[0]
    });

  } catch (error) {
    console.error('Playlist create error:', error);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

/**
 * GET /api/playlists/:id
 * Get single playlist with songs
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    // Get playlist
    const playlistResult = await query(`
      SELECT * FROM playlists
      WHERE id = $1 AND user_id = $2
    `, [req.params.id, req.user.id]);

    if (playlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    // Get songs in playlist
    const songsResult = await query(`
      SELECT s.id, s.title, s.artist, s.album, s.duration, s.artwork_url,
             ps.position
      FROM playlist_songs ps
      JOIN songs s ON ps.song_id = s.id
      WHERE ps.playlist_id = $1
      ORDER BY ps.position ASC
    `, [req.params.id]);

    res.json({
      ...playlistResult.rows[0],
      songs: songsResult.rows
    });

  } catch (error) {
    console.error('Playlist fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

/**
 * GET /api/playlists/share/:code
 * Get shared playlist (public view)
 */
router.get('/share/:code', optionalAuth, async (req, res) => {
  try {
    // Get playlist by share code
    const playlistResult = await query(`
      SELECT p.id, p.name, p.description, p.user_id,
             u.username as owner_username
      FROM playlists p
      JOIN users u ON p.user_id = u.id
      WHERE p.share_code = $1 AND p.is_public = true
    `, [req.params.code.toUpperCase()]);

    if (playlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found or not public' });
    }

    // Get songs (metadata only - no file URLs for non-owners)
    const songsResult = await query(`
      SELECT s.title, s.artist, s.album, s.duration, ps.position
      FROM playlist_songs ps
      JOIN songs s ON ps.song_id = s.id
      WHERE ps.playlist_id = $1
      ORDER BY ps.position ASC
    `, [playlistResult.rows[0].id]);

    res.json({
      ...playlistResult.rows[0],
      songs: songsResult.rows
    });

  } catch (error) {
    console.error('Shared playlist error:', error);
    res.status(500).json({ error: 'Failed to fetch shared playlist' });
  }
});

/**
 * PUT /api/playlists/:id
 * Update playlist details
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { name, description, is_public } = req.body;

    const result = await query(`
      UPDATE playlists
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          is_public = COALESCE($3, is_public),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND user_id = $5
      RETURNING *
    `, [name, description, is_public, req.params.id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    res.json({
      message: 'Playlist updated',
      playlist: result.rows[0]
    });

  } catch (error) {
    console.error('Playlist update error:', error);
    res.status(500).json({ error: 'Failed to update playlist' });
  }
});

/**
 * DELETE /api/playlists/:id
 * Delete playlist
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM playlists WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    res.json({ message: 'Playlist deleted' });

  } catch (error) {
    console.error('Playlist delete error:', error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

/**
 * POST /api/playlists/:id/songs
 * Add song to playlist
 */
router.post('/:id/songs', authenticateToken, async (req, res) => {
  try {
    const { song_id } = req.body;

    if (!song_id) {
      return res.status(400).json({ error: 'song_id is required' });
    }

    // Verify playlist ownership
    const playlistCheck = await query(
      'SELECT id FROM playlists WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (playlistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    // Verify song ownership
    const songCheck = await query(
      'SELECT id FROM songs WHERE id = $1 AND user_id = $2',
      [song_id, req.user.id]
    );

    if (songCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Get next position
    const positionResult = await query(
      'SELECT COALESCE(MAX(position), 0) + 1 as next_position FROM playlist_songs WHERE playlist_id = $1',
      [req.params.id]
    );

    const position = positionResult.rows[0].next_position;

    // Add song to playlist
    await query(`
      INSERT INTO playlist_songs (playlist_id, song_id, position)
      VALUES ($1, $2, $3)
      ON CONFLICT (playlist_id, song_id) DO NOTHING
    `, [req.params.id, song_id, position]);

    // Update playlist timestamp
    await query(
      'UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'Song added to playlist' });

  } catch (error) {
    console.error('Add song to playlist error:', error);
    res.status(500).json({ error: 'Failed to add song to playlist' });
  }
});

/**
 * DELETE /api/playlists/:id/songs/:songId
 * Remove song from playlist
 */
router.delete('/:id/songs/:songId', authenticateToken, async (req, res) => {
  try {
    // Verify playlist ownership
    const playlistCheck = await query(
      'SELECT id FROM playlists WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (playlistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    // Remove song
    await query(
      'DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2',
      [req.params.id, req.params.songId]
    );

    // Update playlist timestamp
    await query(
      'UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'Song removed from playlist' });

  } catch (error) {
    console.error('Remove song from playlist error:', error);
    res.status(500).json({ error: 'Failed to remove song from playlist' });
  }
});

/**
 * PUT /api/playlists/:id/reorder
 * Reorder songs in playlist
 */
router.put('/:id/reorder', authenticateToken, async (req, res) => {
  try {
    const { song_ids } = req.body;

    if (!Array.isArray(song_ids)) {
      return res.status(400).json({ error: 'song_ids array is required' });
    }

    // Verify playlist ownership
    const playlistCheck = await query(
      'SELECT id FROM playlists WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (playlistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    // Update positions
    for (let i = 0; i < song_ids.length; i++) {
      await query(
        'UPDATE playlist_songs SET position = $1 WHERE playlist_id = $2 AND song_id = $3',
        [i + 1, req.params.id, song_ids[i]]
      );
    }

    res.json({ message: 'Playlist reordered' });

  } catch (error) {
    console.error('Playlist reorder error:', error);
    res.status(500).json({ error: 'Failed to reorder playlist' });
  }
});

module.exports = router;
