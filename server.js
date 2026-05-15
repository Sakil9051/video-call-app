const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mediasoup = require('mediasoup');
const config = require('./config');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Mediasoup state
let workers = [];
let nextWorkerIdx = 0;
const rooms = new Map(); // roomId -> { router, participants: { socketId: { transports, producers, consumers } } }

// --- Mediasoup Initialization ---
const createWorkers = async () => {
  const { numWorkers, workerSettings } = config.mediasoup;
  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker(workerSettings);
    worker.on('died', () => {
      console.error(`worker died, exiting in 2 seconds... [pid:${worker.pid}]`);
      setTimeout(() => process.exit(1), 2000);
    });
    workers.push(worker);
  }
};

const getNextWorker = () => {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
};

// --- Socket.io Logic ---
io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  socket.on('join-room', async ({ roomId, userId, username }, callback) => {
    // 1. Initialize room if not exists
    if (!rooms.has(roomId)) {
      const worker = getNextWorker();
      const router = await worker.createRouter(config.mediasoup.routerOptions);
      rooms.set(roomId, {
        router,
        participants: new Map(), // socketId -> data
        waitingParticipants: new Map(), // socketId -> data
        adminUserId: userId, // THIS IS THE PERMANENT OWNER
        adminSocketId: socket.id,
        admittedUserIds: new Set([userId]),
        cleanupTimeout: null
      });
      console.log(`[Room ${roomId}] Created by original host: ${username} (${userId})`);
    }

    const room = rooms.get(roomId);
    
    // --- HOST RECLAMATION ---
    if (room.adminUserId === userId) {
      console.log(`>>> [RECLAIM_ATTEMPT] Host ${username} matches original owner ID <<<`);
      room.adminSocketId = socket.id; 
      
      // Force broadcast to everyone
      io.to(roomId).emit('admin-changed', { adminSocketId: socket.id });
      
      // Redundant broadcast after 100ms just in case of network jitter
      setTimeout(() => {
        io.to(roomId).emit('admin-changed', { adminSocketId: socket.id });
      }, 100);

      if (room.cleanupTimeout) {
        clearTimeout(room.cleanupTimeout);
        room.cleanupTimeout = null;
        console.log(`[Room ${roomId}] Grace period stopped - Host is active.`);
      }
    }
    // -----------------------------------------

    // 3. Check if user is already admitted
    const isAdmitted = room.admittedUserIds.has(userId);

    if (!isAdmitted) {
      room.waitingParticipants.set(socket.id, { userId, username });
      console.log(`[Room ${roomId}] User ${username} is waiting...`);
      
      io.to(room.adminSocketId).emit('user-waiting', { socketId: socket.id, userId, username });
      
      return callback({ 
        rtpCapabilities: room.router.rtpCapabilities,
        adminSocketId: room.adminSocketId,
        isWaiting: true 
      });
    }

    // 4. Fully join the room
    socket.join(roomId); 
    room.participants.set(socket.id, {
      userId,
      username,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map()
    });

    console.log(`[Room ${roomId}] Active join: ${username}`);

    // Notify others
    socket.to(roomId).emit('user-joined', { 
      socketId: socket.id, 
      userId, 
      username,
      isMuted: true,
      isVideoOff: true
    });

    // Send back info to client
    callback({ 
      rtpCapabilities: room.router.rtpCapabilities,
      adminSocketId: room.adminSocketId,
      isWaiting: false,
      waitingUsers: room.adminUserId === userId ? 
        Array.from(room.waitingParticipants.entries()).map(([sId, data]) => ({ socketId: sId, ...data })) : [],
      existingParticipants: Array.from(room.participants.entries())
        .filter(([sId]) => sId !== socket.id) // Don't include self
        .map(([sId, p]) => {
          let isMuted = true;
          let isVideoOff = true;
          p.producers.forEach(producer => {
            if (producer.kind === 'audio') isMuted = producer.paused;
            if (producer.kind === 'video') isVideoOff = producer.paused;
          });
          return { 
            socketId: sId, 
            userId: p.userId, 
            username: p.username,
            isMuted,
            isVideoOff
          };
        })
    });
  });

  // --- Transport Logic ---
  socket.on('createWebRtcTransport', async ({ roomId, direction }, callback) => {
    const room = rooms.get(roomId);
    const { router } = room;

    const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransportOptions);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') transport.close();
    });

    const participant = room.participants.get(socket.id);
    if (!participant) {
      console.error(`[SFU] createWebRtcTransport failed: User ${socket.id} is not a participant`);
      return;
    }
    participant.transports.set(transport.id, transport);

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }
    });
  });

  socket.on('connectWebRtcTransport', async ({ roomId, transportId, dtlsParameters }, callback) => {
    const room = rooms.get(roomId);
    const participant = room.participants.get(socket.id);
    if (!participant) return;
    const transport = participant.transports.get(transportId);
    if (!transport) return;
    await transport.connect({ dtlsParameters });
    if (callback) callback();
  });

  // --- Production Logic (User sending media) ---
  socket.on('produce', async ({ roomId, transportId, kind, rtpParameters, appData }, callback) => {
    const room = rooms.get(roomId);
    const participant = room.participants.get(socket.id);
    if (!participant) return;
    const transport = participant.transports.get(transportId);
    if (!transport) return;

    const producer = await transport.produce({ kind, rtpParameters, appData });
    participant.producers.set(producer.id, producer);

    console.log(`[Room ${roomId}] User ${participant.username} is producing ${kind}`);

    // Tell everyone else there is a new producer
    socket.to(roomId).emit('new-producer', {
      socketId: socket.id,
      producerId: producer.id,
      kind: producer.kind
    });

    producer.on('transportclose', () => {
      producer.close();
      participant.producers.delete(producer.id);
    });

    callback({ id: producer.id });
  });

  // --- Consumption Logic (User receiving media) ---
  socket.on('consume', async ({ roomId, rtpCapabilities, remoteProducerId, serverConsumerTransportId }, callback) => {
    const room = rooms.get(roomId);
    const participant = room.participants.get(socket.id);
    if (!participant) return callback({ error: 'User not a participant' });
    const router = room.router;

    if (!router.canConsume({ producerId: remoteProducerId, rtpCapabilities })) {
      return callback({ error: 'Cannot consume' });
    }

    const transport = participant.transports.get(serverConsumerTransportId);
    if (!transport) return callback({ error: 'Transport not found' });
    const consumer = await transport.consume({
      producerId: remoteProducerId,
      rtpCapabilities,
      paused: true, // Start paused, let client resume
    });

    participant.consumers.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      consumer.close();
      participant.consumers.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      consumer.close();
      participant.consumers.delete(consumer.id);
      socket.emit('consumer-closed', { consumerId: consumer.id });
    });

    callback({
      params: {
        id: consumer.id,
        producerId: remoteProducerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      }
    });
  });

  socket.on('resume', async ({ roomId, consumerId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const participant = room.participants.get(socket.id);
    if (!participant) return;
    const consumer = participant.consumers.get(consumerId);
    if (consumer) await consumer.resume();
  });

  socket.on('pause-producer', async ({ roomId, producerId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const participant = room.participants.get(socket.id);
    if (participant) {
      const producer = participant.producers.get(producerId);
      if (producer) {
        await producer.pause();
        console.log(`[Room ${roomId}] User ${participant.username} paused producer ${producer.kind} (${producerId})`);
        socket.to(roomId).emit('producer-paused', { socketId: socket.id, producerId, kind: producer.kind });
      }
    }
  });

  socket.on('resume-producer', async ({ roomId, producerId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const participant = room.participants.get(socket.id);
    if (participant) {
      const producer = participant.producers.get(producerId);
      if (producer) {
        await producer.resume();
        console.log(`[Room ${roomId}] User ${participant.username} resumed producer ${producer.kind} (${producerId})`);
        socket.to(roomId).emit('producer-resumed', { socketId: socket.id, producerId, kind: producer.kind });
      }
    }
  });

  socket.on('admit-user', async ({ roomId, targetSocketId }) => {
    const room = rooms.get(roomId);
    if (!room || room.adminSocketId !== socket.id) return;

    const waiter = room.waitingParticipants.get(targetSocketId);
    if (waiter) {
      room.admittedUserIds.add(waiter.userId); // PERSIST ADMISSION
      room.waitingParticipants.delete(targetSocketId);
      // We don't add them to room.participants yet; 
      // the client will re-call join-room and get admitted
      
      console.log(`[Room ${roomId}] Host admitted user: ${waiter.username} (${waiter.userId})`);
      io.to(targetSocketId).emit('admitted', { roomId });
      
      // We don't notify others yet. They will be notified 
      // when the guest actually joins and calls 'join-room' again.
    }
  });

  socket.on('reject-user', ({ roomId, targetSocketId }) => {
    const room = rooms.get(roomId);
    if (!room || room.adminSocketId !== socket.id) return;

    const waiter = room.waitingParticipants.get(targetSocketId);
    if (waiter) {
      room.waitingParticipants.delete(targetSocketId);
      console.log(`[Room ${roomId}] Host rejected user: ${waiter.username}`);
      io.to(targetSocketId).emit('rejected', { roomId });
    }
  });

  // --- Utility ---
  socket.on('get-producers', ({ roomId }, callback) => {
    const room = rooms.get(roomId);
    if (!room) return callback([]);
    const producerList = [];
    
    room.participants.forEach((p, sId) => {
      if (sId !== socket.id) {
        p.producers.forEach((producer) => {
          producerList.push({
            socketId: sId,
            producerId: producer.id,
            kind: producer.kind,
            paused: producer.paused,
            username: p.username  // Include username so new joiners know who they're consuming
          });
        });
      }
    });

    callback(producerList);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`[-] Socket disconnected: ${socket.id}`);
    
    rooms.forEach((room, roomId) => {
      if (room.participants.has(socket.id)) {
        const participant = room.participants.get(socket.id);
        
        // Close all their producers and consumers
        participant.producers.forEach(p => p.close());
        participant.consumers.forEach(c => c.close());
        participant.transports.forEach(t => t.close());
        
        room.participants.delete(socket.id);
        
        // Tell others
        socket.to(roomId).emit('user-left', { socketId: socket.id, userId: participant.userId });
        console.log(`[Room ${roomId}] User left: ${participant.username}`);
        
        // Check waiting list too
        if (room.waitingParticipants.has(socket.id)) {
          room.waitingParticipants.delete(socket.id);
          // Notify admin so they can remove the request from UI
          io.to(room.adminSocketId).emit('waiting-user-left', { socketId: socket.id });
        }

        // Handle admin migration if the host left
        if (room.adminSocketId === socket.id) {
          if (room.participants.size > 0) {
            const nextAdminSocketId = room.participants.keys().next().value;
            // Keep the adminUserId as the original owner
            // But update adminSocketId to the new temporary admin
            room.adminSocketId = nextAdminSocketId;
            console.log(`[Room ${roomId}] Temporary admin promoted: ${room.participants.get(nextAdminSocketId).username}`);
            io.to(roomId).emit('admin-changed', { adminSocketId: nextAdminSocketId });
          } else {
            // No other participants left. 
            // Wait 10 seconds for host to reload before killing the room.
            console.log(`[Room ${roomId}] Host disconnected. Waiting 10s for reload...`);
            room.cleanupTimeout = setTimeout(() => {
              console.log(`[Room ${roomId}] Cleanup timeout reached. Closing room.`);
              room.waitingParticipants.forEach((p, sId) => {
                io.to(sId).emit('rejected', { roomId, reason: 'Host closed the room' });
              });
              rooms.delete(roomId);
            }, 10000); // 10 second grace period
          }
        }
      }
    });
  });
});

app.get('/', (req, res) => {
  res.send('PeerConnect Mediasoup SFU is running.');
});

const PORT = config.listenPort || 3001;
createWorkers().then(() => {
  server.listen(PORT, () => {
    console.log(`Mediasoup SFU running on port ${PORT}`);
  });
});
