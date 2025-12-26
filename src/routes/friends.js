/**
 * Friends Routes
 * Friend requests, list, and active sessions
 */

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/friends
 * Get user's friends list (accepted friendships)
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        u.id,
        u.username,
        u.email,
        f.created_at as friends_since,
        CASE 
          WHEN f.requester_id = $1 THEN 'sent'
          ELSE 'received'
        END as request_origin
      FROM friendships f
      JOIN users u ON (
        CASE 
          WHEN f.requester_id = $1 THEN f.addressee_id = u.id
          ELSE f.requester_id = u.id
        END
      )
      WHERE (f.requester_id = $1 OR f.addressee_id = $1)
        AND f.status = 'accepted'
      ORDER BY u.username ASC
    `, [req.user.id]);

    res.json({
      count: result.rows.length,
      friends: result.rows
    });

  } catch (error) {
    console.error('Friends list error:', error);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

/**
 * GET /api/friends/pending
 * Get pending friend requests (received)
 */
router.get('/pending', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        f.id as request_id,
        u.id as user_id,
        u.username,
        u.email,
        f.created_at as requested_at
      FROM friendships f
      JOIN users u ON f.requester_id = u.id
      WHERE f.addressee_id = $1
        AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [req.user.id]);

    res.json({
      count: result.rows.length,
      requests: result.rows
    });

  } catch (error) {
    console.error('Pending requests error:', error);
    res.status(500).json({ error: 'Failed to fetch pending requests' });
  }
});

/**
 * GET /api/friends/sent
 * Get sent friend requests (outgoing)
 */
router.get('/sent', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        f.id as request_id,
        u.id as user_id,
        u.username,
        u.email,
        f.created_at as requested_at
      FROM friendships f
      JOIN users u ON f.addressee_id = u.id
      WHERE f.requester_id = $1
        AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [req.user.id]);

    res.json({
      count: result.rows.length,
      requests: result.rows
    });

  } catch (error) {
    console.error('Sent requests error:', error);
    res.status(500).json({ error: 'Failed to fetch sent requests' });
  }
});

/**
 * POST /api/friends/request
 * Send a friend request
 */
router.post('/request', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Find user by username
    const userResult = await query(
      'SELECT id, username FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const addressee = userResult.rows[0];

    // Can't friend yourself
    if (addressee.id === req.user.id) {
      return res.status(400).json({ error: "You can't send a friend request to yourself" });
    }

    // Check if friendship already exists (in either direction)
    const existingResult = await query(`
      SELECT id, status FROM friendships 
      WHERE (requester_id = $1 AND addressee_id = $2)
         OR (requester_id = $2 AND addressee_id = $1)
    `, [req.user.id, addressee.id]);

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Already friends with this user' });
      } else if (existing.status === 'pending') {
        return res.status(400).json({ error: 'Friend request already pending' });
      } else if (existing.status === 'blocked') {
        return res.status(400).json({ error: 'Cannot send friend request' });
      }
    }

    // Create friend request
    const result = await query(`
      INSERT INTO friendships (requester_id, addressee_id, status)
      VALUES ($1, $2, 'pending')
      RETURNING id, created_at
    `, [req.user.id, addressee.id]);

    res.status(201).json({
      message: 'Friend request sent',
      request_id: result.rows[0].id,
      to_user: addressee.username
    });

  } catch (error) {
    console.error('Friend request error:', error);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

/**
 * PUT /api/friends/accept/:requestId
 * Accept a friend request
 */
router.put('/accept/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;

    // Verify this request is addressed to current user
    const result = await query(`
      UPDATE friendships 
      SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
      RETURNING id
    `, [requestId, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Friend request not found or already processed' });
    }

    res.json({ message: 'Friend request accepted' });

  } catch (error) {
    console.error('Accept friend error:', error);
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

/**
 * PUT /api/friends/decline/:requestId
 * Decline a friend request
 */
router.put('/decline/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;

    const result = await query(`
      UPDATE friendships 
      SET status = 'declined', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
      RETURNING id
    `, [requestId, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Friend request not found or already processed' });
    }

    res.json({ message: 'Friend request declined' });

  } catch (error) {
    console.error('Decline friend error:', error);
    res.status(500).json({ error: 'Failed to decline friend request' });
  }
});

/**
 * DELETE /api/friends/:friendId
 * Remove a friend
 */
router.delete('/:friendId', authenticateToken, async (req, res) => {
  try {
    const { friendId } = req.params;

    const result = await query(`
      DELETE FROM friendships 
      WHERE ((requester_id = $1 AND addressee_id = $2)
         OR (requester_id = $2 AND addressee_id = $1))
        AND status = 'accepted'
      RETURNING id
    `, [req.user.id, friendId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    res.json({ message: 'Friend removed' });

  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

/**
 * GET /api/friends/listening
 * Get friends who are currently live (have active sessions)
 */
router.get('/listening', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        u.id,
        u.username,
        s.title as session_title,
        s.started_at,
        s.listener_count,
        s.current_song_title,
        s.current_song_artist
      FROM active_sessions s
      JOIN users u ON s.host_id = u.id
      JOIN friendships f ON (
        (f.requester_id = $1 AND f.addressee_id = u.id)
        OR (f.addressee_id = $1 AND f.requester_id = u.id)
      )
      WHERE f.status = 'accepted'
      ORDER BY s.started_at DESC
    `, [req.user.id]);

    res.json({
      count: result.rows.length,
      sessions: result.rows
    });

  } catch (error) {
    console.error('Friends listening error:', error);
    res.status(500).json({ error: 'Failed to fetch active sessions' });
  }
});

/**
 * POST /api/friends/session/start
 * Mark user as live (create active session)
 */
router.post('/session/start', authenticateToken, async (req, res) => {
  try {
    const { title, songTitle, songArtist } = req.body;

    // Upsert active session
    const result = await query(`
      INSERT INTO active_sessions (host_id, title, current_song_title, current_song_artist)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (host_id) 
      DO UPDATE SET 
        title = EXCLUDED.title,
        current_song_title = EXCLUDED.current_song_title,
        current_song_artist = EXCLUDED.current_song_artist,
        started_at = CURRENT_TIMESTAMP,
        listener_count = 0
      RETURNING id
    `, [req.user.id, title || 'Listening Session', songTitle, songArtist]);

    res.json({ 
      message: 'Session started',
      session_id: result.rows[0].id 
    });

  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

/**
 * PUT /api/friends/session/update
 * Update active session (song info, listener count)
 */
router.put('/session/update', authenticateToken, async (req, res) => {
  try {
    const { songTitle, songArtist, listenerCount } = req.body;

    await query(`
      UPDATE active_sessions 
      SET 
        current_song_title = COALESCE($2, current_song_title),
        current_song_artist = COALESCE($3, current_song_artist),
        listener_count = COALESCE($4, listener_count)
      WHERE host_id = $1
    `, [req.user.id, songTitle, songArtist, listenerCount]);

    res.json({ message: 'Session updated' });

  } catch (error) {
    console.error('Update session error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

/**
 * DELETE /api/friends/session/end
 * End active session
 */
router.delete('/session/end', authenticateToken, async (req, res) => {
  try {
    await query('DELETE FROM active_sessions WHERE host_id = $1', [req.user.id]);
    res.json({ message: 'Session ended' });

  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

module.exports = router;
