/**
 * Library Routes
 * Songs CRUD operations + Bulk Management
 */

const express = require('express');
const router = express.Router();
const https = require('https');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * Helper: Make HTTPS GET request (works in all Node.js versions)
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Fetch album artwork from iTunes API
 * @param {string} artist 
 * @param {string} album 
 * @param {string} title - fallback search term
 * @returns {string|null} artwork URL or null
 */
async function fetchAlbumArtwork(artist, album, title) {
  try {
    // Try artist + album first
    let searchTerm = `${artist || ''} ${album || ''}`.trim();
    
    if (!searchTerm) {
      searchTerm = `${artist || ''} ${title || ''}`.trim();
    }
    
    if (!searchTerm) return null;
    
    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&entity=album&limit=1`;
    
    const data = await httpsGet(searchUrl);
    
    if (data.results && data.results.length > 0) {
      // Get artwork URL and upgrade to 600x600
      let artworkUrl = data.results[0].artworkUrl100;
      if (artworkUrl) {
        artworkUrl = artworkUrl.replace('100x100bb', '600x600bb');
        return artworkUrl;
      }
    }
    
    // Fallback: try artist + title if album search failed
    if (album && title) {
      const fallbackTerm = `${artist || ''} ${title}`.trim();
      const fallbackUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(fallbackTerm)}&media=music&entity=song&limit=1`;
      
      const fallbackData = await httpsGet(fallbackUrl);
      if (fallbackData.results && fallbackData.results.length > 0) {
        let artworkUrl = fallbackData.results[0].artworkUrl100;
        if (artworkUrl) {
          return artworkUrl.replace('100x100bb', '600x600bb');
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('iTunes artwork fetch error:', error.message);
    return null;
  }
}

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
 * DELETE /api/library/bulk
 * Delete multiple songs
 */
router.delete('/bulk', authenticateToken, async (req, res) => {
  try {
    const { songIds } = req.body;

    if (!Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ error: 'songIds array is required' });
    }

    if (songIds.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 songs per request' });
    }

    // Get total file size for storage update
    const sizeResult = await query(
      `SELECT COALESCE(SUM(file_size), 0) as total_size 
       FROM songs WHERE id = ANY($1) AND user_id = $2`,
      [songIds, req.user.id]
    );
    const totalSize = parseInt(sizeResult.rows[0].total_size) || 0;

    // Delete songs
    const deleteResult = await query(
      'DELETE FROM songs WHERE id = ANY($1) AND user_id = $2 RETURNING id',
      [songIds, req.user.id]
    );

    // Update user storage
    if (totalSize > 0) {
      await query(
        'UPDATE users SET storage_used = GREATEST(storage_used - $1, 0) WHERE id = $2',
        [totalSize, req.user.id]
      );
    }

    res.json({
      message: `Deleted ${deleteResult.rowCount} songs`,
      deletedCount: deleteResult.rowCount,
      freedBytes: totalSize
    });

  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: 'Failed to delete songs' });
  }
});

/**
 * PUT /api/library/bulk
 * Update metadata for multiple songs
 */
router.put('/bulk', authenticateToken, async (req, res) => {
  try {
    const { songIds, updates } = req.body;

    if (!Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ error: 'songIds array is required' });
    }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'updates object is required' });
    }

    if (songIds.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 songs per request' });
    }

    // Build dynamic update query - only update provided fields
    const allowedFields = ['title', 'artist', 'album', 'genre', 'year'];
    const setClauses = [];
    const values = [songIds, req.user.id];
    let paramIndex = 3;

    for (const field of allowedFields) {
      if (updates[field] !== undefined && updates[field] !== '') {
        setClauses.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updateQuery = `
      UPDATE songs 
      SET ${setClauses.join(', ')}
      WHERE id = ANY($1) AND user_id = $2
      RETURNING id, title, artist, album, genre, year
    `;

    const result = await query(updateQuery, values);

    res.json({
      message: `Updated ${result.rowCount} songs`,
      updatedCount: result.rowCount,
      songs: result.rows
    });

  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({ error: 'Failed to update songs' });
  }
});

/**
 * POST /api/library/bulk/parse-filename
 * Extract artist/title from filename and update metadata
 */
router.post('/bulk/parse-filename', authenticateToken, async (req, res) => {
  try {
    const { songIds } = req.body;

    if (!Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ error: 'songIds array is required' });
    }

    if (songIds.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 songs per request' });
    }

    // Get songs with their file URLs
    const songsResult = await query(
      'SELECT id, title, artist, file_url FROM songs WHERE id = ANY($1) AND user_id = $2',
      [songIds, req.user.id]
    );

    const results = {
      updated: [],
      skipped: [],
      failed: []
    };

    for (const song of songsResult.rows) {
      try {
        // Extract filename from URL
        const urlParts = song.file_url.split('/');
        let filename = decodeURIComponent(urlParts[urlParts.length - 1]);
        
        // Remove file extension
        filename = filename.replace(/\.[^/.]+$/, '');
        
        // Remove common suffixes in parentheses/brackets
        const cleanFilename = filename
          .replace(/\s*[\(\[](official|video|audio|music video|lyric|lyrics|hd|hq|4k|1080p|720p|explicit|clean|remaster|remastered)[\)\]]\s*/gi, '')
          .replace(/\s*[\(\[].*?(official|video|audio).*?[\)\]]\s*/gi, '')
          .trim();
        
        // Try to parse "Artist - Title" pattern
        let newArtist = null;
        let newTitle = null;
        
        // Pattern 1: "Artist - Title"
        if (cleanFilename.includes(' - ')) {
          const parts = cleanFilename.split(' - ');
          newArtist = parts[0].trim();
          newTitle = parts.slice(1).join(' - ').trim(); // Handle multiple dashes in title
        }
        // Pattern 2: "Artist — Title" (em dash)
        else if (cleanFilename.includes(' — ')) {
          const parts = cleanFilename.split(' — ');
          newArtist = parts[0].trim();
          newTitle = parts.slice(1).join(' — ').trim();
        }
        // Pattern 3: Just use filename as title, leave artist
        else {
          newTitle = cleanFilename;
        }
        
        // Clean up extra whitespace
        if (newArtist) newArtist = newArtist.replace(/\s+/g, ' ').trim();
        if (newTitle) newTitle = newTitle.replace(/\s+/g, ' ').trim();
        
        // Skip if we didn't parse anything useful
        if (!newTitle && !newArtist) {
          results.skipped.push({ id: song.id, title: song.title, reason: 'Could not parse filename' });
          continue;
        }
        
        // Only update if we found new data
        const updates = [];
        const params = [];
        let paramCount = 0;
        
        if (newArtist && (song.artist === 'Unknown Artist' || !song.artist)) {
          paramCount++;
          updates.push(`artist = $${paramCount}`);
          params.push(newArtist);
        }
        
        if (newTitle && newTitle !== song.title) {
          paramCount++;
          updates.push(`title = $${paramCount}`);
          params.push(newTitle);
        }
        
        if (updates.length === 0) {
          results.skipped.push({ id: song.id, title: song.title, reason: 'No changes needed' });
          continue;
        }
        
        // Update the song
        paramCount++;
        params.push(song.id);
        
        await query(
          `UPDATE songs SET ${updates.join(', ')} WHERE id = $${paramCount}`,
          params
        );
        
        results.updated.push({
          id: song.id,
          oldTitle: song.title,
          oldArtist: song.artist,
          newTitle: newTitle || song.title,
          newArtist: newArtist || song.artist
        });
        
      } catch (err) {
        results.failed.push({ id: song.id, title: song.title, error: err.message });
      }
    }

    res.json({
      message: `Processed ${songsResult.rows.length} songs`,
      ...results
    });

  } catch (error) {
    console.error('Bulk parse filename error:', error);
    res.status(500).json({ error: 'Failed to parse filenames' });
  }
});

/**
 * POST /api/library/bulk/fetch-artwork
 * Re-fetch iTunes artwork for multiple songs
 * NOTE: This route MUST come before /:id/fetch-artwork to avoid "bulk" being matched as an ID
 */
router.post('/bulk/fetch-artwork', authenticateToken, async (req, res) => {
  try {
    const { songIds } = req.body;

    if (!Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ error: 'songIds array is required' });
    }

    if (songIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 songs per artwork fetch request' });
    }

    // Get song details
    const songsResult = await query(
      'SELECT id, title, artist, album FROM songs WHERE id = ANY($1) AND user_id = $2',
      [songIds, req.user.id]
    );

    const results = {
      updated: [],
      notFound: [],
      failed: []
    };

    // Process each song (with small delay to avoid rate limiting)
    for (const song of songsResult.rows) {
      try {
        const artworkUrl = await fetchAlbumArtwork(song.artist, song.album, song.title);

        if (artworkUrl) {
          await query(
            'UPDATE songs SET artwork_url = $1 WHERE id = $2',
            [artworkUrl, song.id]
          );
          results.updated.push({ id: song.id, title: song.title, artwork_url: artworkUrl });
        } else {
          results.notFound.push({ id: song.id, title: song.title });
        }

        // Small delay to avoid iTunes rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (err) {
        results.failed.push({ id: song.id, title: song.title, error: err.message });
      }
    }

    res.json({
      message: `Processed ${songsResult.rows.length} songs`,
      ...results
    });

  } catch (error) {
    console.error('Bulk fetch artwork error:', error);
    res.status(500).json({ error: 'Failed to fetch artwork' });
  }
});

/**
 * POST /api/library/:id/fetch-artwork
 * Re-fetch iTunes artwork for a single song
 */
router.post('/:id/fetch-artwork', authenticateToken, async (req, res) => {
  try {
    // Get song details
    const songResult = await query(
      'SELECT id, title, artist, album FROM songs WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (songResult.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const song = songResult.rows[0];

    // Fetch artwork from iTunes
    const artworkUrl = await fetchAlbumArtwork(song.artist, song.album, song.title);

    if (!artworkUrl) {
      return res.status(404).json({ error: 'No artwork found on iTunes' });
    }

    // Update song with new artwork
    const updateResult = await query(
      'UPDATE songs SET artwork_url = $1 WHERE id = $2 RETURNING *',
      [artworkUrl, song.id]
    );

    res.json({
      message: 'Artwork updated',
      song: updateResult.rows[0]
    });

  } catch (error) {
    console.error('Fetch artwork error:', error);
    res.status(500).json({ error: 'Failed to fetch artwork' });
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
