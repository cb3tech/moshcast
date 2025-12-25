/**
 * Moshcast Backend - Entry Point
 * Your Music. Your Library. Everywhere.
 * Now with WebSocket support for Go Live!
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
const liveRoutes = require('./routes/live');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: ['https://moshcast.com', 'https://www.moshcast.com', 'http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

// Store active sessions: { username: { hostSocketId, song, position, isPlaying, listeners: Set } }
const activeSessions = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Host starts a session
  socket.on('host:start', (data) => {
    const { username, song } = data;
    const roomName = `live:${username.toLowerCase()}`;
    
    // Join the room as host
    socket.join(roomName);
    
    // Create/update session
    activeSessions.set(username.toLowerCase(), {
      hostSocketId: socket.id,
      username: username,
      song: song,
      position: 0,
      isPlaying: true,
      startedAt: Date.now(),
      lastUpdate: Date.now(),
      listeners: new Set()
    });

    console.log(`🎙️ Host started session: ${username}`);
    socket.emit('host:started', { success: true });
  });

  // Host updates state (song change, play/pause, position)
  socket.on('host:update', (data) => {
    const { username, song, position, isPlaying } = data;
    const session = activeSessions.get(username.toLowerCase());
    
    if (session && session.hostSocketId === socket.id) {
      // Update session
      if (song) session.song = song;
      if (position !== undefined) session.position = position;
      if (isPlaying !== undefined) session.isPlaying = isPlaying;
      session.lastUpdate = Date.now();

      // Broadcast to all listeners in the room
      const roomName = `live:${username.toLowerCase()}`;
      socket.to(roomName).emit('stream:update', {
        song: session.song,
        position: session.position,
        isPlaying: session.isPlaying,
        serverTime: Date.now()
      });
    }
  });

  // Host ends session
  socket.on('host:end', (data) => {
    const { username } = data;
    const roomName = `live:${username.toLowerCase()}`;
    
    // Notify all listeners
    io.to(roomName).emit('stream:ended', { message: 'Host ended the session' });
    
    // Clean up
    activeSessions.delete(username.toLowerCase());
    console.log(`🛑 Host ended session: ${username}`);
  });

  // Listener joins a session
  socket.on('listener:join', (data) => {
    const { username, listenerName } = data;
    const roomName = `live:${username.toLowerCase()}`;
    const session = activeSessions.get(username.toLowerCase());

    if (!session) {
      socket.emit('stream:error', { error: 'Session not found', code: 'NOT_FOUND' });
      return;
    }

    // Join the room
    socket.join(roomName);
    
    // Add to listeners
    session.listeners.add(socket.id);
    
    // Store listener info on socket
    socket.listenerData = { 
      username: username.toLowerCase(), 
      name: listenerName || 'Anonymous' 
    };

    // Send current state to the new listener
    const elapsed = (Date.now() - session.lastUpdate) / 1000;
    const currentPosition = session.isPlaying ? session.position + elapsed : session.position;

    socket.emit('stream:state', {
      song: session.song,
      position: currentPosition,
      isPlaying: session.isPlaying,
      listenerCount: session.listeners.size
    });

    // Notify host and other listeners of new listener count
    io.to(roomName).emit('stream:listeners', { count: session.listeners.size });

    // Notify chat
    io.to(roomName).emit('chat:message', {
      type: 'system',
      text: `${listenerName || 'Someone'} joined`,
      timestamp: Date.now()
    });

    console.log(`👂 Listener joined ${username}: ${session.listeners.size} total`);
  });

  // Chat message
  socket.on('chat:send', (data) => {
    const { username, message, senderName } = data;
    const roomName = `live:${username.toLowerCase()}`;

    io.to(roomName).emit('chat:message', {
      type: 'user',
      username: senderName,
      text: message,
      timestamp: Date.now(),
      senderId: socket.id
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);

    // Check if this was a host
    for (const [username, session] of activeSessions.entries()) {
      if (session.hostSocketId === socket.id) {
        // Host disconnected - end session
        const roomName = `live:${username}`;
        io.to(roomName).emit('stream:ended', { message: 'Host disconnected' });
        activeSessions.delete(username);
        console.log(`🛑 Host disconnected, session ended: ${username}`);
        return;
      }

      // Check if this was a listener
      if (session.listeners.has(socket.id)) {
        session.listeners.delete(socket.id);
        const roomName = `live:${username}`;
        
        // Update listener count
        io.to(roomName).emit('stream:listeners', { count: session.listeners.size });
        
        // Notify chat
        if (socket.listenerData) {
          io.to(roomName).emit('chat:message', {
            type: 'system',
            text: `${socket.listenerData.name} left`,
            timestamp: Date.now()
          });
        }
        
        console.log(`👂 Listener left ${username}: ${session.listeners.size} remaining`);
      }
    }
  });
});

// Make io accessible to routes
app.set('io', io);
app.set('activeSessions', activeSessions);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'Moshcast API',
    version: '1.2.0',
    status: 'running',
    message: 'Your Music. Your Library. Everywhere.',
    features: ['auth', 'library', 'playlists', 'upload', 'live-streaming', 'websocket'],
    activeSessions: activeSessions.size
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/live', liveRoutes);

// Error handling middleware
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

// Start server (use server.listen instead of app.listen for Socket.IO)
server.listen(PORT, () => {
  console.log(`
  🎵 Moshcast API Server
  ━━━━━━━━━━━━━━━━━━━━━━
  Status:  Running
  Port:    ${PORT}
  Env:     ${process.env.NODE_ENV || 'development'}
  Socket:  ENABLED ✓
  ━━━━━━━━━━━━━━━━━━━━━━
  `);
});

module.exports = { app, server, io };
