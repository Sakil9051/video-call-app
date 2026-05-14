const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity, in production you can restrict this to your Vercel domain
    methods: ["GET", "POST"]
  }
});

// Store room participants: roomId -> Array of { socketId, userId, username }
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // When a user joins a room
  socket.on('join-room', ({ roomId, userId, username }) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }

    // Add user to our tracked room state if not already there
    const existing = rooms[roomId].find(p => p.userId === userId);
    if (!existing) {
      rooms[roomId].push({ socketId: socket.id, userId, username });
    } else {
      // Update socket ID if they reconnected
      existing.socketId = socket.id;
    }

    console.log(`[Room ${roomId}] User joined: ${username} (${userId})`);

    // Get list of other users in the room
    const otherUsers = rooms[roomId].filter(p => p.socketId !== socket.id);
    
    // Tell the joining user who else is in the room so they can initiate WebRTC calls
    socket.emit('room-users', otherUsers);

    // Tell everyone else in the room that a new user joined
    socket.to(roomId).emit('user-joined', { socketId: socket.id, userId, username });
  });

  // Relay WebRTC signaling data (Offers, Answers, ICE Candidates)
  socket.on('signal', ({ targetSocketId, signal, callerId, callerUsername }) => {
    io.to(targetSocketId).emit('signal', {
      senderSocketId: socket.id,
      senderUserId: callerId,
      senderUsername: callerUsername,
      signal
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`[-] Socket disconnected: ${socket.id}`);
    
    // Find which room this socket was in
    for (const roomId in rooms) {
      const userIndex = rooms[roomId].findIndex(p => p.socketId === socket.id);
      if (userIndex !== -1) {
        const user = rooms[roomId][userIndex];
        // Remove from tracked array
        rooms[roomId].splice(userIndex, 1);
        
        // Tell others in the room
        socket.to(roomId).emit('user-left', { socketId: socket.id, userId: user.userId });
        console.log(`[Room ${roomId}] User left: ${user.username}`);
        
        // Clean up empty rooms
        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
        }
        break; // A socket is only in one room in our app
      }
    }
  });
});

app.get('/', (req, res) => {
  res.send('PeerConnect Signaling Server is running.');
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
