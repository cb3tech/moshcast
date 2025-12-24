/**
 * Database Migration Script
 * Creates all tables for Moshcast
 * 
 * Run with: npm run db:migrate
 */

require('dotenv').config();
const { pool } = require('./database');

const migrate = async () => {
  console.log('🔄 Running database migrations...\n');

  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        username VARCHAR(50) UNIQUE NOT NULL,
        plan VARCHAR(20) DEFAULT 'free' CHECK (plan IN ('free', 'plus', 'pro', 'unlimited')),
        storage_used BIGINT DEFAULT 0,
        storage_limit BIGINT DEFAULT 16106127360,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Users table created');

    // Songs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS songs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        artist VARCHAR(255),
        album VARCHAR(255),
        track_number INTEGER,
        duration INTEGER,
        year INTEGER,
        genre VARCHAR(100),
        file_url VARCHAR(500) NOT NULL,
        file_size BIGINT NOT NULL,
        format VARCHAR(20),
        artwork_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Songs table created');

    // Playlists table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS playlists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        is_public BOOLEAN DEFAULT false,
        share_code VARCHAR(20) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Playlists table created');

    // Playlist songs junction table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS playlist_songs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
        song_id UUID REFERENCES songs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(playlist_id, song_id)
      );
    `);
    console.log('✅ Playlist_songs table created');

    // Play history table (for analytics)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS play_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        song_id UUID REFERENCES songs(id) ON DELETE CASCADE,
        played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        duration_played INTEGER
      );
    `);
    console.log('✅ Play_history table created');

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_songs_user_id ON songs(user_id);
      CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
      CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album);
      CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id);
      CREATE INDEX IF NOT EXISTS idx_playlists_share_code ON playlists(share_code);
      CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist_id ON playlist_songs(playlist_id);
      CREATE INDEX IF NOT EXISTS idx_play_history_user_id ON play_history(user_id);
    `);
    console.log('✅ Indexes created');

    console.log('\n🎉 All migrations completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

migrate();
