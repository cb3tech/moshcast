# Moshcast Backend Architecture

## ⚠️ CRITICAL - READ BEFORE MODIFYING

### src/index.js - MAIN ENTRY POINT
**DO NOT REPLACE THIS FILE - ONLY ADD TO IT**

This file contains:
- Express server setup
- **Socket.IO server** (required for Go Live feature)
- All route imports and registrations

When adding new routes:
```javascript
// 1. Add import at top with other routes
const newRoutes = require('./routes/newroute');

// 2. Add app.use() with other routes
app.use('/api/newroute', newRoutes);
```

**NEVER** replace the entire file - you will break Socket.IO/Go Live.

---

## File Structure

```
src/
├── index.js          # ⚠️ CRITICAL - Express + Socket.IO server
├── config/
│   ├── database.js   # PostgreSQL connection
│   └── migrate.js    # Database migrations (safe to update)
├── middleware/
│   └── auth.js       # JWT verification
└── routes/
    ├── auth.js       # User authentication
    ├── library.js    # Music library CRUD
    ├── playlists.js  # Playlist management
    ├── upload.js     # File uploads to R2
    ├── settings.js   # User settings
    ├── feeds.js      # RSS feeds
    └── friends.js    # Friends system
```

---

## Features & Dependencies

| Feature | Files | Notes |
|---------|-------|-------|
| Go Live (streaming) | index.js (Socket.IO) | WebSocket-based, real-time |
| Friends | routes/friends.js, migrate.js | Database tables: friendships, active_sessions |
| Upload | routes/upload.js | Cloudflare R2 storage |
| Auth | routes/auth.js, middleware/auth.js | JWT tokens |

---

## Adding New Features

1. Create new route file in `src/routes/`
2. Add database tables to `src/config/migrate.js`
3. **In index.js**: Add import + app.use() only (don't replace file)
4. Update this ARCHITECTURE.md

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | Dec 2024 | Initial: auth, library, playlists, upload |
| 1.1.0 | Dec 2024 | Added settings, feeds |
| 1.2.0 | Dec 2024 | Added Socket.IO for Go Live |
| 1.3.0 | Dec 2024 | Added friends system |
