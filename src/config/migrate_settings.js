/**
 * Settings Migration Script
 * Adds user_settings and user_rss_feeds tables
 * 
 * Run with: node src/config/migrate_settings.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const migrate = async () => {
  console.log('🔄 Running settings migrations...\n');

  try {
    // User Settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        playback_quality VARCHAR(20) DEFAULT 'high',
        crossfade_seconds INTEGER DEFAULT 0,
        gapless_enabled BOOLEAN DEFAULT true,
        normalize_volume BOOLEAN DEFAULT false,
        cache_limit_mb INTEGER DEFAULT 1000,
        rss_refresh_minutes INTEGER DEFAULT 60,
        rss_max_articles INTEGER DEFAULT 50,
        theme VARCHAR(20) DEFAULT 'dark',
        profile_public BOOLEAN DEFAULT false,
        show_listening_activity BOOLEAN DEFAULT false,
        playlist_default_public BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ user_settings table created');

    // User RSS Feeds table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_rss_feeds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        feed_url VARCHAR(500) NOT NULL,
        feed_name VARCHAR(100),
        genre_tag VARCHAR(50),
        enabled BOOLEAN DEFAULT true,
        last_fetched TIMESTAMP,
        fetch_error VARCHAR(255),
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, feed_url)
      );
    `);
    console.log('✅ user_rss_feeds table created');

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_rss_feeds_user_id ON user_rss_feeds(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_rss_feeds_genre ON user_rss_feeds(genre_tag);
    `);
    console.log('✅ Indexes created');

    console.log('\n🎉 Settings migrations completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

migrate();
