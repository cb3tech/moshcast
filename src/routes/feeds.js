/**
 * RSS Feeds Routes
 * Music news aggregation for users
 */

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const Parser = require('rss-parser');

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'media'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['enclosure', 'enclosure'],
      ['dc:creator', 'creator'],
      ['content:encoded', 'contentEncoded']
    ]
  },
  timeout: 10000
});

// Max feeds per user
const MAX_FEEDS_PER_USER = 20;

// Popular music news feeds (suggestions)
const SUGGESTED_FEEDS = [
  { name: 'Pitchfork', url: 'https://pitchfork.com/rss/news/', genre: 'Indie' },
  { name: 'Rolling Stone', url: 'https://www.rollingstone.com/music/feed/', genre: 'General' },
  { name: 'NME', url: 'https://www.nme.com/news/music/feed', genre: 'Rock' },
  { name: 'Billboard', url: 'https://www.billboard.com/feed/', genre: 'Pop' },
  { name: 'Stereogum', url: 'https://www.stereogum.com/feed/', genre: 'Indie' },
  { name: 'Consequence', url: 'https://consequence.net/feed/', genre: 'Rock' },
  { name: 'EDM.com', url: 'https://edm.com/feed', genre: 'Electronic' },
  { name: 'HipHopDX', url: 'https://hiphopdx.com/feed', genre: 'Hip-Hop' },
  { name: 'Metal Injection', url: 'https://metalinjection.net/feed', genre: 'Metal' },
  { name: 'Brooklyn Vegan', url: 'https://www.brooklynvegan.com/feed/', genre: 'Indie' }
];

/**
 * Extract image URL from RSS item
 */
function extractImageUrl(item) {
  // Try various common image fields
  if (item.media && item.media.$) {
    return item.media.$.url;
  }
  if (item.mediaThumbnail && item.mediaThumbnail.$) {
    return item.mediaThumbnail.$.url;
  }
  if (item.enclosure && item.enclosure.type && item.enclosure.type.startsWith('image')) {
    return item.enclosure.url;
  }
  if (item['media:content'] && item['media:content'].$) {
    return item['media:content'].$.url;
  }
  
  // Try to extract from content
  const content = item.contentEncoded || item.content || item.description || '';
  const imgMatch = content.match(/<img[^>]+src="([^">]+)"/);
  if (imgMatch) {
    return imgMatch[1];
  }
  
  return null;
}

/**
 * GET /api/feeds
 * Get user's RSS feeds
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT id, feed_url, feed_name, genre_tag, enabled, last_fetched, fetch_error, added_at
      FROM user_rss_feeds
      WHERE user_id = $1
      ORDER BY added_at DESC
    `, [req.user.id]);

    res.json({
      count: result.rows.length,
      max_feeds: MAX_FEEDS_PER_USER,
      feeds: result.rows
    });

  } catch (error) {
    console.error('Get feeds error:', error);
    res.status(500).json({ error: 'Failed to fetch feeds' });
  }
});

/**
 * GET /api/feeds/suggestions
 * Get suggested music news feeds
 */
router.get('/suggestions', authenticateToken, async (req, res) => {
  const { genre } = req.query;
  
  let suggestions = SUGGESTED_FEEDS;
  
  if (genre) {
    suggestions = suggestions.filter(f => 
      f.genre.toLowerCase() === genre.toLowerCase()
    );
  }
  
  res.json({
    suggestions,
    genres: [...new Set(SUGGESTED_FEEDS.map(f => f.genre))]
  });
});

/**
 * POST /api/feeds
 * Add a new RSS feed
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { feed_url, feed_name, genre_tag } = req.body;

    if (!feed_url) {
      return res.status(400).json({ error: 'feed_url is required' });
    }

    // Validate URL format
    try {
      new URL(feed_url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Check feed limit
    const countResult = await query(
      'SELECT COUNT(*) FROM user_rss_feeds WHERE user_id = $1',
      [req.user.id]
    );
    
    if (parseInt(countResult.rows[0].count) >= MAX_FEEDS_PER_USER) {
      return res.status(400).json({ 
        error: `Maximum ${MAX_FEEDS_PER_USER} feeds allowed. Remove one to add another.` 
      });
    }

    // Validate feed is parseable
    let feedData;
    try {
      feedData = await parser.parseURL(feed_url);
    } catch (parseError) {
      return res.status(400).json({ 
        error: 'Could not parse RSS feed. Check URL is valid RSS/Atom feed.',
        details: parseError.message
      });
    }

    // Use feed title if no name provided
    const finalName = feed_name || feedData.title || 'Untitled Feed';

    // Insert feed
    const result = await query(`
      INSERT INTO user_rss_feeds (user_id, feed_url, feed_name, genre_tag)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, feed_url) DO UPDATE SET
        feed_name = EXCLUDED.feed_name,
        genre_tag = EXCLUDED.genre_tag
      RETURNING *
    `, [req.user.id, feed_url, finalName, genre_tag || null]);

    res.status(201).json({
      message: 'Feed added',
      feed: result.rows[0],
      preview: {
        title: feedData.title,
        description: feedData.description,
        item_count: feedData.items?.length || 0
      }
    });

  } catch (error) {
    console.error('Add feed error:', error);
    res.status(500).json({ error: 'Failed to add feed' });
  }
});

/**
 * PUT /api/feeds/:id
 * Update a feed (name, genre, enabled)
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { feed_name, genre_tag, enabled } = req.body;

    const result = await query(`
      UPDATE user_rss_feeds
      SET feed_name = COALESCE($1, feed_name),
          genre_tag = COALESCE($2, genre_tag),
          enabled = COALESCE($3, enabled)
      WHERE id = $4 AND user_id = $5
      RETURNING *
    `, [feed_name, genre_tag, enabled, req.params.id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Feed not found' });
    }

    res.json({
      message: 'Feed updated',
      feed: result.rows[0]
    });

  } catch (error) {
    console.error('Update feed error:', error);
    res.status(500).json({ error: 'Failed to update feed' });
  }
});

/**
 * DELETE /api/feeds/:id
 * Remove a feed
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM user_rss_feeds WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Feed not found' });
    }

    res.json({ message: 'Feed removed' });

  } catch (error) {
    console.error('Delete feed error:', error);
    res.status(500).json({ error: 'Failed to delete feed' });
  }
});

/**
 * GET /api/feeds/news
 * Fetch and aggregate news from all enabled user feeds
 */
router.get('/news', authenticateToken, async (req, res) => {
  try {
    const { genre, limit = 50 } = req.query;
    const maxArticles = Math.min(parseInt(limit), 200);

    // Get user's settings for max articles
    const settingsResult = await query(
      'SELECT rss_max_articles FROM user_settings WHERE user_id = $1',
      [req.user.id]
    );
    const userMaxArticles = settingsResult.rows[0]?.rss_max_articles || 50;
    const finalLimit = Math.min(maxArticles, userMaxArticles);

    // Get user's enabled feeds
    let feedsQuery = `
      SELECT id, feed_url, feed_name, genre_tag
      FROM user_rss_feeds
      WHERE user_id = $1 AND enabled = true
    `;
    const feedsParams = [req.user.id];

    if (genre) {
      feedsQuery += ' AND genre_tag = $2';
      feedsParams.push(genre);
    }

    const feedsResult = await query(feedsQuery, feedsParams);

    if (feedsResult.rows.length === 0) {
      return res.json({
        count: 0,
        articles: [],
        message: 'No feeds configured. Add feeds in settings.'
      });
    }

    // Fetch all feeds in parallel
    const allArticles = [];
    const feedErrors = [];

    await Promise.all(feedsResult.rows.map(async (feed) => {
      try {
        const feedData = await parser.parseURL(feed.feed_url);
        
        // Update last_fetched timestamp
        await query(
          'UPDATE user_rss_feeds SET last_fetched = CURRENT_TIMESTAMP, fetch_error = NULL WHERE id = $1',
          [feed.id]
        );

        // Process items
        feedData.items.forEach(item => {
          allArticles.push({
            feed_id: feed.id,
            feed_name: feed.feed_name,
            genre: feed.genre_tag,
            title: item.title,
            link: item.link,
            description: item.contentSnippet || item.description?.replace(/<[^>]*>/g, '').substring(0, 300),
            image_url: extractImageUrl(item),
            author: item.creator || item.author,
            published: item.pubDate || item.isoDate,
            published_timestamp: new Date(item.pubDate || item.isoDate).getTime()
          });
        });

      } catch (fetchError) {
        // Log error but continue with other feeds
        feedErrors.push({
          feed_id: feed.id,
          feed_name: feed.feed_name,
          error: fetchError.message
        });

        // Update feed with error
        await query(
          'UPDATE user_rss_feeds SET fetch_error = $1 WHERE id = $2',
          [fetchError.message.substring(0, 255), feed.id]
        );
      }
    }));

    // Sort by published date (newest first) and limit
    allArticles.sort((a, b) => (b.published_timestamp || 0) - (a.published_timestamp || 0));
    const limitedArticles = allArticles.slice(0, finalLimit);

    // Clean up response
    limitedArticles.forEach(a => delete a.published_timestamp);

    res.json({
      count: limitedArticles.length,
      total_available: allArticles.length,
      feeds_fetched: feedsResult.rows.length - feedErrors.length,
      feeds_errored: feedErrors.length,
      articles: limitedArticles,
      errors: feedErrors.length > 0 ? feedErrors : undefined
    });

  } catch (error) {
    console.error('Fetch news error:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

/**
 * GET /api/feeds/:id/preview
 * Preview a specific feed's content
 */
router.get('/:id/preview', authenticateToken, async (req, res) => {
  try {
    // Get feed
    const feedResult = await query(
      'SELECT * FROM user_rss_feeds WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (feedResult.rows.length === 0) {
      return res.status(404).json({ error: 'Feed not found' });
    }

    const feed = feedResult.rows[0];

    // Fetch and parse
    const feedData = await parser.parseURL(feed.feed_url);

    // Update last_fetched
    await query(
      'UPDATE user_rss_feeds SET last_fetched = CURRENT_TIMESTAMP, fetch_error = NULL WHERE id = $1',
      [feed.id]
    );

    // Process items (limit to 10 for preview)
    const articles = feedData.items.slice(0, 10).map(item => ({
      title: item.title,
      link: item.link,
      description: item.contentSnippet || item.description?.replace(/<[^>]*>/g, '').substring(0, 300),
      image_url: extractImageUrl(item),
      author: item.creator || item.author,
      published: item.pubDate || item.isoDate
    }));

    res.json({
      feed: {
        id: feed.id,
        name: feed.feed_name,
        url: feed.feed_url,
        genre: feed.genre_tag
      },
      meta: {
        title: feedData.title,
        description: feedData.description,
        link: feedData.link,
        total_items: feedData.items.length
      },
      articles
    });

  } catch (error) {
    console.error('Preview feed error:', error);
    res.status(500).json({ error: 'Failed to preview feed', details: error.message });
  }
});

module.exports = router;
