/**
 * Moshcast Backend - Entry Point
 * Your Music. Your Library. Everywhere.
 * v1.2.0 - Socket.IO for Go Live
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// Import routes
const authRoutes = require('./routes/auth');
const libraryRoutes = require('./routes/library');
const playlistRoutes = require('./routes/playlists');
const uploadRoutes = require('./routes/upload');
const settingsRoutes = require('./routes/settings');
const feedsRoutes = require('./routes/feeds');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server and Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['https://moshcast.com', 'http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: ['https://moshcast.com', 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'Moshcast API',
    version: '1.2.0',
    status: 'running',
    message: 'Your Music. Your Library. Everywhere.',
    features: ['library', 'playlists', 'upload', 'settings', 'rss-feeds', 'golive']
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/feeds', feedsRoutes);

// ============================================
// GO LIVE - Socket.IO Implementation
// ============================================

// Active streaming sessions: { username: { hostSocketId, song, isPlaying, position, startedAt, listeners: Set } }
const sessions = {};

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Host starts a stream
  socket.on('host:start', ({ username, song }) => {
    console.log(`📻 Host starting stream: ${username}`);
    
    // Create or update session
    sessions[username] = {
      hostSocketId: socket.id,
      song: song,
      isPlaying: true,
      position: 0,
      startedAt: Date.now(),
      listeners: new Set()
    };

    // Join host to their room
    socket.join(`stream:${username}`);
    
    // Confirm to host
    socket.emit('host:started', { 
      success: true, 
      listenerCount: 0 
    });

    console.log(`✅ Stream started for ${username}`);
  });

  // Host updates stream state (song change, play/pause, seek)
  socket.on('host:update', ({ username, song, isPlaying, position }) => {
    if (!sessions[username] || sessions[username].hostSocketId !== socket.id) {
      socket.emit('stream:error', { error: 'Not authorized', code: 'NOT_HOST' });
      return;
    }

    // Update session
    if (song !== undefined) sessions[username].song = song;
    if (isPlaying !== undefined) sessions[username].isPlaying = isPlaying;
    if (position !== undefined) {
      sessions[username].position = position;
      sessions[username].startedAt = Date.now(); // Reset timer on seek
    }

    // Broadcast to all listeners in the room
    socket.to(`stream:${username}`).emit('stream:update', {
      song: sessions[username].song,
      isPlaying: sessions[username].isPlaying,
      position: sessions[username].position
    });

    console.log(`📡 Stream update for ${username}: playing=${isPlaying}, pos=${position}`);
  });

  // Host ends stream
  socket.on('host:end', ({ username }) => {
    if (!sessions[username] || sessions[username].hostSocketId !== socket.id) {
      return;
    }

    // Notify all listeners
    io.to(`stream:${username}`).emit('stream:ended', { 
      message: 'The host ended the stream' 
    });

    // Cleanup
    delete sessions[username];
    console.log(`🛑 Stream ended: ${username}`);
  });

  // Listener joins a stream
  socket.on('listener:join', ({ username, listenerName }) => {
    console.log(`👂 Listener joining ${username}: ${listenerName}`);

    const session = sessions[username];
    
    if (!session) {
      socket.emit('stream:error', { 
        error: 'Stream not found or offline', 
        code: 'NOT_FOUND' 
      });
      return;
    }

    // Add to listeners set
    session.listeners.add(socket.id);
    
    // Join the stream room
    socket.join(`stream:${username}`);
    
    // Store username on socket for cleanup
    socket.streamUsername = username;
    socket.listenerName = listenerName;

    // Calculate current position based on elapsed time
    let currentPosition = session.position;
    if (session.isPlaying && session.song) {
      const elapsed = (Date.now() - session.startedAt) / 1000;
      currentPosition = session.position + elapsed;
    }

    // Send current stream state to new listener
    socket.emit('stream:state', {
      song: session.song,
      isPlaying: session.isPlaying,
      position: currentPosition,
      listenerCount: session.listeners.size
    });

    // Broadcast updated listener count
    io.to(`stream:${username}`).emit('stream:listeners', { 
      count: session.listeners.size 
    });

    // Notify room of new listener
    socket.to(`stream:${username}`).emit('chat:message', {
      type: 'system',
      text: `${listenerName} joined the stream`,
      timestamp: new Date().toISOString()
    });

    console.log(`✅ ${listenerName} joined ${username}'s stream (${session.listeners.size} listeners)`);
  });

  // Chat message
  socket.on('chat:send', ({ username, message, senderName }) => {
    const session = sessions[username];
    if (!session) return;

    // Broadcast to all in room (including sender)
    io.to(`stream:${username}`).emit('chat:message', {
      type: 'chat',
      username: senderName,
      text: message,
      timestamp: new Date().toISOString(),
      senderId: socket.id
    });

    console.log(`💬 Chat in ${username}'s stream: ${senderName}: ${message}`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);

    // Check if this was a host
    for (const [username, session] of Object.entries(sessions)) {
      if (session.hostSocketId === socket.id) {
        // Host disconnected - end the stream
        io.to(`stream:${username}`).emit('stream:ended', { 
          message: 'The host disconnected' 
        });
        delete sessions[username];
        console.log(`🛑 Host disconnected, stream ended: ${username}`);
        return;
      }

      // Check if this was a listener
      if (session.listeners.has(socket.id)) {
        session.listeners.delete(socket.id);
        
        // Broadcast updated count
        io.to(`stream:${username}`).emit('stream:listeners', { 
          count: session.listeners.size 
        });

        // Notify room
        if (socket.listenerName) {
          socket.to(`stream:${username}`).emit('chat:message', {
            type: 'system',
            text: `${socket.listenerName} left the stream`,
            timestamp: new Date().toISOString()
          });
        }

        console.log(`👋 Listener left ${username}'s stream (${session.listeners.size} remaining)`);
      }
    }
  });
});

// ============================================
// Error Handling
// ============================================

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server (use 'server' not 'app' for Socket.IO)
server.listen(PORT, () => {
  console.log(`
  🎵 Moshcast API Server
  ─────────────────────
  Status:  Running
  Port:    ${PORT}
  Env:     ${process.env.NODE_ENV || 'development'}
  Socket:  Enabled (Go Live ready)
  ─────────────────────
  `);
});

module.exports = { app, server, io };
