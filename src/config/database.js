/**
 * Database Configuration
 * PostgreSQL connection using pg
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection
pool.on('connect', () => {
  console.log('📦 Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err.message);
});

// Query helper
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Query executed:', { text: text.substring(0, 50), duration: `${duration}ms`, rows: result.rowCount });
    }
    
    return result;
  } catch (error) {
    console.error('Query error:', error.message);
    throw error;
  }
};

module.exports = {
  pool,
  query
};
