/**
 * Library Routes
 * Songs CRUD operations
 */

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/library
 * Get user's entire library
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { sort = 'created_at', order = 'DESC', search } = req.query;

    // Validate sort field
    const validSorts = ['title', 'artist', 'album', 'created_at', 'duration'];
    const sortField = validSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let queryText = `
      SELECT id, title, artist, album, track_number, duration, year, genre,
             file_url, file_size, format, artwork_url, created_at
      FROM songs
      WHERE user_id = $1
    `;
    const params = [req.user.id];

    // Add search filter
    if (search) {
      queryText += ` AND (title ILIKE $2 OR artist ILIKE $2 OR album ILIKE $2)`;
      params.push(`%${search}%`);
    }

    queryText += ` ORDER BY ${sortField} ${sortOrder}`;

    const result = await query(queryText, params);

    res.json({
      count: result.rows.length,
      songs: result.rows
    });

  } catch (error) {
    console.error('Library fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

/**
 * GET /api/library/albums
 * Get grouped albums
 */
router.get('/albums', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT album, artist, MIN(artwork_url) as artwork_url,
             COUNT(*) as song_count, SUM(duration) as total_duration,
             MIN(year) as year
      FROM songs
      WHERE user_id = $1 AND album IS NOT NULL AND album != ''
      GROUP BY album, artist
      ORDER BY album ASC
    `, [req.user.id]);

    res.json({
      count: result.rows.length,
      albums: result.rows
    });

  } catch (error) {
    console.error('Albums fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch albums' });
  }
});

/**
 * GET /api/library/artists
 * Get grouped artists
 */
router.get('/artists', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT artist, COUNT(*) as song_count,
             COUNT(DISTINCT album) as album_count
      FROM songs
      WHERE user_id = $1 AND artist IS NOT NULL AND artist != ''
      GROUP BY artist
      ORDER BY artist ASC
    `, [req.user.id]);

    res.json({
      count: result.rows.length,
      artists: result.rows
    });

  } catch (error) {
    console.error('Artists fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch artists' });
  }
});

/**
 * GET /api/library/recent
 * Get recently added songs
 */
router.get('/recent', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const result = await query(`
      SELECT id, title, artist, album, duration, artwork_url, created_at
      FROM songs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [req.user.id, limit]);

    res.json({
      songs: result.rows
    });

  } catch (error) {
    console.error('Recent songs error:', error);
    res.status(500).json({ error: 'Failed to fetch recent songs' });
  }
});

/**
 * GET /api/library/:id
 * Get single song details
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM songs
      WHERE id = $1 AND user_id = $2
    `, [req.params.id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Song fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch song' });
  }
});

/**
 * PUT /api/library/:id
 * Update song metadata
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { title, artist, album, track_number, year, genre } = req.body;

    const result = await query(`
      UPDATE songs
      SET title = COALESCE($1, title),
          artist = COALESCE($2, artist),
          album = COALESCE($3, album),
          track_number = COALESCE($4, track_number),
          year = COALESCE($5, year),
          genre = COALESCE($6, genre)
      WHERE id = $7 AND user_id = $8
      RETURNING *
    `, [title, artist, album, track_number, year, genre, req.params.id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    res.json({
      message: 'Song updated',
      song: result.rows[0]
    });

  } catch (error) {
    console.error('Song update error:', error);
    res.status(500).json({ error: 'Failed to update song' });
  }
});

/**
 * DELETE /api/library/:id
 * Delete a song
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // Get song to retrieve file size
    const songResult = await query(
      'SELECT file_size FROM songs WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (songResult.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const fileSize = songResult.rows[0].file_size;

    // Delete song
    await query('DELETE FROM songs WHERE id = $1', [req.params.id]);

    // Update user storage
    await query(
      'UPDATE users SET storage_used = storage_used - $1 WHERE id = $2',
      [fileSize, req.user.id]
    );

    // TODO: Delete file from R2 storage

    res.json({ message: 'Song deleted' });

  } catch (error) {
    console.error('Song delete error:', error);
    res.status(500).json({ error: 'Failed to delete song' });
  }
});

module.exports = router;
