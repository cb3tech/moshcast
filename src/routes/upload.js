/**
 * Upload Routes
 * Handle music file uploads to Cloudflare R2
 * NOW WITH ALBUM ART EXTRACTION
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const mm = require('music-metadata');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Configure multer for memory storage (we'll stream to R2)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max per file
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'audio/mpeg',       // MP3
      'audio/mp4',        // M4A/AAC
      'audio/x-m4a',      // M4A
      'audio/aac',        // AAC
      'audio/flac',       // FLAC
      'audio/x-flac',     // FLAC
      'audio/wav',        // WAV
      'audio/x-wav',      // WAV
      'audio/ogg',        // OGG
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: MP3, M4A, AAC, FLAC, WAV, OGG`));
    }
  }
});

// Configure R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Get file extension from mimetype
const getExtension = (mimetype) => {
  const map = {
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
  };
  return map[mimetype] || 'mp3';
};

// Get image extension from mimetype
const getImageExtension = (mimetype) => {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return map[mimetype] || 'jpg';
};

/**
 * Extract and upload album artwork from audio file
 * Returns the public URL of the artwork, or null if none found
 */
async function extractAndUploadArtwork(parsed, userId, fileId) {
  try {
    // Check if there's embedded artwork
    const pictures = parsed.common.picture;
    if (!pictures || pictures.length === 0) {
      return null;
    }

    // Get the first picture (usually the front cover)
    const picture = pictures[0];
    const imageData = picture.data;
    const imageMimeType = picture.format || 'image/jpeg';
    const imageExtension = getImageExtension(imageMimeType);

    // Generate artwork filename
    const artworkFileName = `${userId}/artwork/${fileId}.${imageExtension}`;

    // Upload artwork to R2
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: artworkFileName,
      Body: imageData,
      ContentType: imageMimeType,
    });

    await r2Client.send(uploadCommand);

    // Return public URL
    return `${process.env.R2_PUBLIC_URL}/${artworkFileName}`;

  } catch (error) {
    console.error('Artwork extraction error:', error.message);
    return null; // Fail silently - artwork is optional
  }
}

/**
 * POST /api/upload
 * Upload music file
 */
router.post('/', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Check storage limit
    const userResult = await query(
      'SELECT storage_used, storage_limit FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = userResult.rows[0];
    const newStorageUsed = user.storage_used + req.file.size;

    if (newStorageUsed > user.storage_limit) {
      return res.status(400).json({
        error: 'Storage limit exceeded',
        storage_used: user.storage_used,
        storage_limit: user.storage_limit,
        file_size: req.file.size
      });
    }

    // Generate unique file ID (used for both audio and artwork)
    const fileId = uuidv4();

    // Extract metadata from audio file
    let metadata = {};
    let artworkUrl = null;
    
    try {
      const parsed = await mm.parseBuffer(req.file.buffer, req.file.mimetype);
      
      metadata = {
        title: parsed.common.title || req.file.originalname.replace(/\.[^/.]+$/, ''),
        artist: parsed.common.artist || 'Unknown Artist',
        album: parsed.common.album || 'Unknown Album',
        track_number: parsed.common.track?.no || null,
        year: parsed.common.year || null,
        genre: parsed.common.genre?.[0] || null,
        duration: Math.round(parsed.format.duration) || 0,
      };

      // Extract and upload artwork
      artworkUrl = await extractAndUploadArtwork(parsed, req.user.id, fileId);
      
    } catch (metaError) {
      console.error('Metadata extraction error:', metaError.message);
      metadata = {
        title: req.file.originalname.replace(/\.[^/.]+$/, ''),
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        duration: 0,
      };
    }

    // Generate audio filename
    const extension = getExtension(req.file.mimetype);
    const fileName = `${req.user.id}/${fileId}.${extension}`;

    // Upload audio to R2
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    });

    await r2Client.send(uploadCommand);

    const fileUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

    // Save to database (now includes artwork_url)
    const songResult = await query(`
      INSERT INTO songs (user_id, title, artist, album, track_number, duration, year, genre, file_url, file_size, format, artwork_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      req.user.id,
      metadata.title,
      metadata.artist,
      metadata.album,
      metadata.track_number,
      metadata.duration,
      metadata.year,
      metadata.genre,
      fileUrl,
      req.file.size,
      extension,
      artworkUrl  // NEW: Save artwork URL
    ]);

    // Update user storage
    await query(
      'UPDATE users SET storage_used = storage_used + $1 WHERE id = $2',
      [req.file.size, req.user.id]
    );

    res.status(201).json({
      message: 'Upload successful',
      song: songResult.rows[0]
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

/**
 * POST /api/upload/batch
 * Upload multiple files
 */
router.post('/batch', authenticateToken, upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    // Check total size against limit
    const totalSize = req.files.reduce((sum, file) => sum + file.size, 0);

    const userResult = await query(
      'SELECT storage_used, storage_limit FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = userResult.rows[0];

    if (user.storage_used + totalSize > user.storage_limit) {
      return res.status(400).json({
        error: 'Storage limit would be exceeded',
        storage_available: user.storage_limit - user.storage_used,
        upload_size: totalSize
      });
    }

    const results = {
      successful: [],
      failed: []
    };

    // Process each file
    for (const file of req.files) {
      try {
        const fileId = uuidv4();
        
        // Extract metadata
        let metadata = {};
        let artworkUrl = null;
        
        try {
          const parsed = await mm.parseBuffer(file.buffer, file.mimetype);
          metadata = {
            title: parsed.common.title || file.originalname.replace(/\.[^/.]+$/, ''),
            artist: parsed.common.artist || 'Unknown Artist',
            album: parsed.common.album || 'Unknown Album',
            track_number: parsed.common.track?.no || null,
            year: parsed.common.year || null,
            genre: parsed.common.genre?.[0] || null,
            duration: Math.round(parsed.format.duration) || 0,
          };
          
          // Extract and upload artwork
          artworkUrl = await extractAndUploadArtwork(parsed, req.user.id, fileId);
          
        } catch {
          metadata = {
            title: file.originalname.replace(/\.[^/.]+$/, ''),
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            duration: 0,
          };
        }

        // Upload audio to R2
        const extension = getExtension(file.mimetype);
        const fileName = `${req.user.id}/${fileId}.${extension}`;

        await r2Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: fileName,
          Body: file.buffer,
          ContentType: file.mimetype,
        }));

        const fileUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

        // Save to database
        const songResult = await query(`
          INSERT INTO songs (user_id, title, artist, album, track_number, duration, year, genre, file_url, file_size, format, artwork_url)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *
        `, [
          req.user.id,
          metadata.title,
          metadata.artist,
          metadata.album,
          metadata.track_number,
          metadata.duration,
          metadata.year,
          metadata.genre,
          fileUrl,
          file.size,
          extension,
          artworkUrl
        ]);

        results.successful.push(songResult.rows[0]);

      } catch (fileError) {
        results.failed.push({
          filename: file.originalname,
          error: fileError.message
        });
      }
    }

    // Update user storage (only for successful uploads)
    const uploadedSize = results.successful.reduce((sum, song) => sum + song.file_size, 0);
    if (uploadedSize > 0) {
      await query(
        'UPDATE users SET storage_used = storage_used + $1 WHERE id = $2',
        [uploadedSize, req.user.id]
      );
    }

    res.status(201).json({
      message: `Uploaded ${results.successful.length} of ${req.files.length} files`,
      ...results
    });

  } catch (error) {
    console.error('Batch upload error:', error);
    res.status(500).json({ error: 'Batch upload failed' });
  }
});

/**
 * GET /api/upload/storage
 * Get current storage usage
 */
router.get('/storage', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT storage_used, storage_limit, plan FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = result.rows[0];

    res.json({
      storage_used: user.storage_used,
      storage_limit: user.storage_limit,
      storage_used_gb: (user.storage_used / 1073741824).toFixed(2),
      storage_limit_gb: (user.storage_limit / 1073741824).toFixed(0),
      storage_available: user.storage_limit - user.storage_used,
      percentage_used: ((user.storage_used / user.storage_limit) * 100).toFixed(1),
      plan: user.plan
    });

  } catch (error) {
    console.error('Storage check error:', error);
    res.status(500).json({ error: 'Failed to check storage' });
  }
});

module.exports = router;
