'use client'

import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import * as mediasoupClient from 'mediasoup-client'
import { loadSettings, buildVideoConstraints, buildAudioConstraints } from '@/lib/settings'

type ConnectionStatus = 'lobby' | 'idle' | 'waiting' | 'connecting' | 'connected' | 'waiting-room' | 'rejected'
type RemotePeer = { 
  socketId: string; 
  userId: string; 
  username: string; 
  stream: MediaStream | null;
  isMuted?: boolean;
  isVideoOff?: boolean;
}

const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001'

// ---- Remote Video (defined OUTSIDE component so it never re-mounts) ----
const RemoteVideo = memo(({ peer, isAdmin }: { peer: RemotePeer, isAdmin: boolean }) => {
  const ref = useRef<HTMLVideoElement>(null)
  const [hasVideo, setHasVideo] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    if (peer.stream) {
      ref.current.srcObject = peer.stream
      const checkVideo = () => {
        const tracks = peer.stream!.getVideoTracks()
        setHasVideo(tracks.length > 0 && tracks[0].readyState === 'live')
      }
      checkVideo()
      peer.stream.addEventListener('addtrack', checkVideo)
      return () => peer.stream!.removeEventListener('addtrack', checkVideo)
    } else {
      ref.current.srcObject = null
      setHasVideo(false)
    }
  }, [peer.stream])

  return (
    <div className="video-container remote connected">
      <div className="video-placeholder" style={{ display: hasVideo ? 'none' : 'flex' }}>
        <div className="avatar">
          <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
        </div>
        <span className="name">{peer.username}</span>
      </div>
      <video
        ref={ref}
        autoPlay
        playsInline
        style={{ display: hasVideo ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <div className="video-label">
        <span className="status-dot connected" />
        {peer.username}
        {isAdmin && <span className="admin-badge">Host</span>}
        {peer.isMuted && (
          <span className="mute-indicator-icon">
            <svg viewBox="0 0 24 24"><path fill="#ff4b4b" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>
          </span>
        )}
      </div>
    </div>
  )
})
RemoteVideo.displayName = 'RemoteVideo'

// ---- Main Component ----
export default function RoomPage() {
  const params = useParams()
  const router = useRouter()
  const roomId = (params.roomId as string).toUpperCase()

  const [user, setUser] = useState<any>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [status, setStatus] = useState<ConnectionStatus>('lobby')
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const [isAudioEnabled, setIsAudioEnabled] = useState(true)
  const [isVideoEnabled, setIsVideoEnabled] = useState(true)
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([])
  const [hasMic, setHasMic] = useState(true)
  const [hasCamera, setHasCamera] = useState(true)
  const [adminSocketId, setAdminSocketId] = useState<string | null>(null)
  const [waitingUsers, setWaitingUsers] = useState<any[]>([])

  // All refs — stable across renders
  const socketRef = useRef<Socket | null>(null)
  const deviceRef = useRef<mediasoupClient.types.Device | null>(null)
  const sendTransportRef = useRef<mediasoupClient.types.Transport | null>(null)
  const recvTransportRef = useRef<mediasoupClient.types.Transport | null>(null)
  const producersRef = useRef<Map<string, mediasoupClient.types.Producer>>(new Map())
  const consumersRef = useRef<Map<string, mediasoupClient.types.Consumer>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const lobbyVideoRef = useRef<HTMLVideoElement>(null)
  // Track streams per peer so we can merge audio+video into one stream
  const peerStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const roomIdRef = useRef(roomId)

  // ---- Auth check ----
  useEffect(() => {
    const cachedUser = sessionStorage.getItem('user')
    if (cachedUser) {
      try { setUser(JSON.parse(cachedUser)); setIsAuthLoading(false); return } catch (e) {}
    }
    fetch('/api/auth/me').then(async res => {
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        sessionStorage.setItem('user', JSON.stringify(data.user))
      } else {
        router.replace(`/?join=${roomId}`)
      }
      setIsAuthLoading(false)
    })
  }, [])

  // ---- Setup lobby media ----
  useEffect(() => {
    if (!user || isAuthLoading) return

    // Check if we should skip lobby (e.g. on reload if previously joined)
    const skipLobby = sessionStorage.getItem(`skipLobby_${roomId}`)
    if (skipLobby === 'true' && status === 'lobby') {
      setStatus('connecting')
      initCall(user)
      return
    }

    if (status !== 'lobby') return

    const setupLobby = async () => {
      try {
        const stream = await getMediaStream()
        localStreamRef.current = stream
        
        const audioTracks = stream.getAudioTracks()
        const videoTracks = stream.getVideoTracks()
        
        setHasMic(audioTracks.length > 0)
        setHasCamera(videoTracks.length > 0)
        
        if (audioTracks.length === 0) setIsAudioEnabled(false)
        if (videoTracks.length === 0) setIsVideoEnabled(false)

        if (lobbyVideoRef.current) {
          lobbyVideoRef.current.srcObject = stream
        }
      } catch (err: any) {
        setError({ title: 'Permission Required', message: err.message })
      }
    }
    setupLobby()
  }, [user, isAuthLoading, status, roomId])
  // Auto-join if already admitted (Lobby Bypass)
  useEffect(() => {
    const autoJoin = async () => {
      if (!user || !roomId || status !== 'lobby') return
      
      // Silent check with server
      const socket = io(SIGNALING_URL, { transports: ['websocket'] })

      try {
        const res: any = await new Promise((resolve, reject) => {
          socket.emit('join-room', { roomId, userId: user.id, username: user.username }, (response: any) => {
            if (response.error) reject(response.error)
            else resolve(response)
          })
          setTimeout(() => reject('timeout'), 2000)
        })

        if (!res.isWaiting) {
          console.log('[SFU] Already admitted, bypassing lobby...')
          socketRef.current = socket
          initCall(user, socket)
        } else {
          socket.disconnect()
        }
      } catch (e) {
        socket.disconnect()
      }
    }

    if (user && status === 'lobby') {
      autoJoin()
    }
  }, [user, roomId, status])

  // Helper: promisify socket emit with callback
  const emitWithAck = useCallback(<T = any>(event: string, data: any): Promise<T> => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current
      if (!socket) return reject(new Error('Socket not connected'))
      socket.emit(event, data, (response: T) => {
        resolve(response)
      })
    })
  }, [])

  const getMediaStream = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera/Microphone not supported in this browser.')
    }
    const s = loadSettings()
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(s),
        audio: buildAudioConstraints(s)
      })
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Camera/Microphone permission denied. Please allow access in your browser and reload.')
      }
      // Fallback: audio only
      try { return await navigator.mediaDevices.getUserMedia({ video: false, audio: true }) }
      catch { return new MediaStream() }
    }
  }

  const createSendTransport = async (): Promise<mediasoupClient.types.Transport> => {
    const res: any = await emitWithAck('createWebRtcTransport', { roomId, direction: 'send' })
    const transport = deviceRef.current!.createSendTransport(res.params)
    sendTransportRef.current = transport

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      socketRef.current?.emit('connectWebRtcTransport', { roomId, transportId: transport.id, dtlsParameters }, callback)
    })
    transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      socketRef.current?.emit('produce', { roomId, transportId: transport.id, kind, rtpParameters, appData }, ({ id }: any) => {
        callback({ id })
      })
    })
    return transport
  }

  const createRecvTransport = async (): Promise<mediasoupClient.types.Transport> => {
    const res: any = await emitWithAck('createWebRtcTransport', { roomId, direction: 'recv' })
    const transport = deviceRef.current!.createRecvTransport(res.params)
    recvTransportRef.current = transport

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      socketRef.current?.emit('connectWebRtcTransport', { roomId, transportId: transport.id, dtlsParameters }, callback)
    })
    return transport
  }

  const startProducing = async (stream: MediaStream) => {
    const videoTrack = stream.getVideoTracks()[0]
    const audioTrack = stream.getAudioTracks()[0]

    if (videoTrack && sendTransportRef.current) {
      const producer = await sendTransportRef.current.produce({ track: videoTrack })
      producersRef.current.set('video', producer)
      if (!isVideoEnabled) {
        await producer.pause()
      }
    } else {
      setIsVideoEnabled(false)
    }

    if (audioTrack && sendTransportRef.current) {
      const producer = await sendTransportRef.current.produce({ track: audioTrack })
      producersRef.current.set('audio', producer)
      if (!isAudioEnabled) {
        await producer.pause()
      }
    } else {
      setIsAudioEnabled(false)
    }
  }

  const consumeProducer = async (producerId: string, socketId: string, kind: string, username?: string, isPaused: boolean = false) => {
    if (!deviceRef.current || !recvTransportRef.current) {
      console.warn('[SFU] Recv transport not ready, skipping consume')
      return
    }
    const { rtpCapabilities } = deviceRef.current
    const res: any = await emitWithAck('consume', {
      roomId,
      rtpCapabilities,
      remoteProducerId: producerId,
      serverConsumerTransportId: recvTransportRef.current.id
    })

    if (!res || res.error) {
      console.error('[SFU] Consume error:', res?.error)
      return
    }

    const consumer = await recvTransportRef.current.consume(res.params)
    consumersRef.current.set(consumer.id, consumer)

    // Merge tracks into a single MediaStream per peer
    let stream = peerStreamsRef.current.get(socketId)
    if (!stream) {
      stream = new MediaStream()
      peerStreamsRef.current.set(socketId, stream)
    }
    stream.addTrack(consumer.track)

    // Force re-render with updated stream reference
    const freshStream = new MediaStream(stream.getTracks())
    peerStreamsRef.current.set(socketId, freshStream)

    setRemotePeers(prev => {
      const existing = prev.find(p => p.socketId === socketId)
      if (existing) {
        return prev.map(p => {
          if (p.socketId === socketId) {
            const updated = { ...p, stream: freshStream }
            if (kind === 'audio') updated.isMuted = isPaused
            if (kind === 'video') updated.isVideoOff = isPaused
            return updated
          }
          return p
        })
      }
      
      return [...prev, { 
        socketId, 
        userId: '', 
        username: username || 'Participant', 
        stream: freshStream,
        isMuted: kind === 'audio' ? isPaused : false,
        isVideoOff: kind === 'video' ? isPaused : false
      }]
    })

    // Resume the consumer if it's not paused by the producer
    if (!isPaused) {
      socketRef.current?.emit('resume', { roomId, consumerId: consumer.id })
    }
  }

  const joinRoom = () => {
    if (status !== 'lobby') return
    setStatus('connecting')
    initCall(user)
  }

  const initCall = async (currentUser: any, existingSocket?: Socket) => {
    try {
      // Use existing stream from lobby if available
      let stream = localStreamRef.current
      if (!stream) {
        stream = await getMediaStream()
        localStreamRef.current = stream
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = stream

      // Step 2: Connect socket (reuse if provided)
      let socket = existingSocket || socketRef.current
      if (!socket || !socket.connected) {
        socket = io(SIGNALING_URL, { transports: ['websocket'] })
        socketRef.current = socket

        await new Promise<void>((resolve, reject) => {
          socket!.on('connect', resolve)
          socket!.on('connect_error', (e) => reject(new Error(`Cannot connect to signaling server: ${e.message}`)))
        })
      }

      // Step 3: Join room and get RTP capabilities
      const { 
        rtpCapabilities, 
        adminSocketId: initialAdmin, 
        isWaiting, 
        waitingUsers: initialWaiting,
        existingParticipants 
      }: any = await emitWithAck('join-room', {
        roomId,
        userId: currentUser.id,
        username: currentUser.username
      })
      setAdminSocketId(initialAdmin)
      if (initialWaiting) setWaitingUsers(initialWaiting)
      
      if (existingParticipants) {
        setRemotePeers(existingParticipants.map((p: any) => ({ 
          ...p, 
          stream: null 
        })))
      }

      if (isWaiting) {
        setStatus('waiting-room')
        setRemotePeers([]) // Clear any background data
        
        socket.off('admitted')
        socket.on('admitted', () => {
          console.log('[SFU] ADMITTED BY HOST!')
          setRemotePeers([]) // Reset for clean start
          peerStreamsRef.current.clear()
          initCall(currentUser, socket)
        })

        socket.off('rejected')
        socket.on('rejected', () => {
          setStatus('rejected')
          cleanup()
        })

        return
      }

      // Step 4: Load device
      const device = new mediasoupClient.Device()
      await device.load({ routerRtpCapabilities: rtpCapabilities })
      deviceRef.current = device

      // Step 5: Create transports
      await createSendTransport()
      await createRecvTransport()

      // Step 6: Start publishing local media
      await startProducing(stream)
      
      // Step 6.5: Sync paused states from lobby
      const videoProducer = producersRef.current.get('video')
      if (videoProducer && !isVideoEnabled) {
        socket.emit('pause-producer', { roomId, producerId: videoProducer.id })
      }
      const audioProducer = producersRef.current.get('audio')
      if (audioProducer && !isAudioEnabled) {
        socket.emit('pause-producer', { roomId, producerId: audioProducer.id })
      }

      // Step 7: Fetch all existing producers and consume them
      const existingProducers: any[] = await emitWithAck('get-producers', { roomId })
      for (const p of existingProducers) {
        await consumeProducer(p.producerId, p.socketId, p.kind, p.username, p.paused)
      }

      // Step 8: Register live event handlers
      socket.off('new-producer')
      socket.on('new-producer', async ({ producerId, socketId, kind, username, paused }: any) => {
        await consumeProducer(producerId, socketId, kind, username, paused)
      })

      socket.off('producer-paused')
      socket.on('producer-paused', ({ socketId, kind }: any) => {
        setRemotePeers(prev => prev.map(p => {
          if (p.socketId === socketId) {
            return { ...p, [kind === 'audio' ? 'isMuted' : 'isVideoOff']: true }
          }
          return p
        }))
      })

      socket.off('producer-resumed')
      socket.on('producer-resumed', ({ socketId, kind }: any) => {
        setRemotePeers(prev => prev.map(p => {
          if (p.socketId === socketId) {
            return { ...p, [kind === 'audio' ? 'isMuted' : 'isVideoOff']: false }
          }
          return p
        }))
      })

      socket.off('user-joined')
      socket.on('user-joined', ({ socketId, userId, username, isMuted, isVideoOff }: any) => {
        setRemotePeers(prev => {
          if (prev.find(p => p.socketId === socketId)) return prev
          return [...prev, { socketId, userId, username, stream: null, isMuted, isVideoOff }]
        })
      })

      socket.off('user-left')
      socket.on('user-left', ({ socketId }: any) => {
        peerStreamsRef.current.delete(socketId)
        setRemotePeers(prev => prev.filter(p => p.socketId !== socketId))
      })

      socket.off('consumer-closed')
      socket.on('consumer-closed', ({ consumerId }: any) => {
        const consumer = consumersRef.current.get(consumerId)
        if (consumer) { consumer.close(); consumersRef.current.delete(consumerId) }
      })

      socket.off('admin-changed')
      socket.on('admin-changed', ({ adminSocketId }: any) => {
        console.log('[SFU] Admin changed to:', adminSocketId)
        setAdminSocketId(adminSocketId)
        // Force update remote peers to ensure badges refresh
        setRemotePeers(prev => [...prev])
      })

      socket.off('user-waiting')
      socket.on('user-waiting', (user: any) => {
        setWaitingUsers(prev => {
          // Remove any existing entry for this USER ID or socket ID
          const filtered = prev.filter(u => u.userId !== user.userId && u.socketId !== user.socketId)
          return [...filtered, user]
        })
      })

      socket.off('waiting-user-left')
      socket.on('waiting-user-left', ({ socketId }: any) => {
        setWaitingUsers(prev => prev.filter(u => u.socketId !== socketId))
      })

      console.log('[SFU] initCall complete, status -> connected')
      setStatus('connected')
      // Set skip lobby flag for reloads
      sessionStorage.setItem(`skipLobby_${roomId}`, 'true')
    } catch (err: any) {
      console.error('[SFU] initCall failed:', err)
      setError({ title: 'Connection Error', message: err.message })
      setStatus('lobby')
    }
  }



  const cleanup = () => {
    sendTransportRef.current?.close()
    recvTransportRef.current?.close()
    socketRef.current?.disconnect()
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    peerStreamsRef.current.clear()
    producersRef.current.clear()
    consumersRef.current.clear()
  }

  const admitUser = (targetSocketId: string) => {
    socketRef.current?.emit('admit-user', { roomId, targetSocketId })
    setWaitingUsers(prev => prev.filter(u => u.socketId !== targetSocketId))
  }

  const rejectUser = (targetSocketId: string) => {
    socketRef.current?.emit('reject-user', { roomId, targetSocketId })
    setWaitingUsers(prev => prev.filter(u => u.socketId !== targetSocketId))
  }

  const endCall = () => { 
    cleanup(); 
    sessionStorage.removeItem(`skipLobby_${roomId}`)
    router.replace('/') 
  }

  const toggleMic = async () => {
    if (status === 'lobby') {
      if (localStreamRef.current) {
        const audioTracks = localStreamRef.current.getAudioTracks();
        if (audioTracks.length === 0) {
          setError({ title: 'Microphone Not Found', message: 'No microphone detected on your device.' });
          return;
        }
        audioTracks.forEach(track => {
          track.enabled = !isAudioEnabled
        })
      }
      setIsAudioEnabled(!isAudioEnabled)
      return
    }

    const producer = producersRef.current.get('audio')
    if (!producer) {
      setError({ title: 'Microphone Not Found', message: 'No active microphone stream was found.' });
      return;
    }
    const willEnable = producer.paused 
    
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = willEnable
      })
    }

    if (willEnable) {
      await producer.resume()
      socketRef.current?.emit('resume-producer', { roomId, producerId: producer.id })
    } else {
      await producer.pause()
      socketRef.current?.emit('pause-producer', { roomId, producerId: producer.id })
    }
    setIsAudioEnabled(willEnable)
  }

  const toggleCamera = async () => {
    if (status === 'lobby') {
      if (localStreamRef.current) {
        const videoTracks = localStreamRef.current.getVideoTracks();
        if (videoTracks.length === 0) {
          setError({ title: 'Camera Not Found', message: 'No camera detected on your device.' });
          return;
        }
        videoTracks.forEach(track => {
          track.enabled = !isVideoEnabled
        })
      }
      setIsVideoEnabled(!isVideoEnabled)
      return
    }

    const producer = producersRef.current.get('video')
    if (!producer) {
      setError({ title: 'Camera Not Found', message: 'No active camera stream was found.' });
      return;
    }
    const willEnable = producer.paused 
    
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = willEnable
      })
    }

    if (willEnable) {
      await producer.resume()
      socketRef.current?.emit('resume-producer', { roomId, producerId: producer.id })
    } else {
      await producer.pause()
      socketRef.current?.emit('pause-producer', { roomId, producerId: producer.id })
    }
    setIsVideoEnabled(willEnable)
  }

  const getRoomUrl = () => typeof window !== 'undefined' ? `${window.location.origin}/room/${roomId}` : ''
  const copyRoomUrl = () => {
    navigator.clipboard.writeText(getRoomUrl()).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2500)
    })
  }

  if (isAuthLoading) return (
    <div className="container">
      <div style={{ textAlign: 'center', marginTop: '100px', color: 'white' }}>Loading...</div>
    </div>
  )

  return (
    <>
      <div className="background-mesh" />
      <div className="container">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div className="logo">
              <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
            </div>
            <h1>PeerConnect SFU</h1>
          </div>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'rgba(255,255,255,0.8)' }}>
              <span>Welcome, <strong>{user.username}</strong></span>
            </div>
          )}
        </header>

        {status === 'lobby' ? (
          <div className="lobby-screen">
            <h2 className="lobby-title">Ready to join?</h2>
            <div className="lobby-preview-container">
              <div className="video-container local lobby-video">
                <div className="video-placeholder" style={{ display: isVideoEnabled ? 'none' : 'flex' }}>
                  <div className="avatar">
                    <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  </div>
                  <span className="name">{user?.username} (You)</span>
                </div>
                <video
                  ref={lobbyVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ display: isVideoEnabled ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                />
              </div>
              
              <div className="lobby-controls">
                <button
                  className={`control-btn tooltip ${!isAudioEnabled ? 'muted' : ''} ${!hasMic ? 'disabled' : ''}`}
                  data-tooltip={!hasMic ? 'No Microphone' : (isAudioEnabled ? 'Mute' : 'Unmute')}
                  onClick={toggleMic}
                >
                  {isAudioEnabled ? (
                    <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>
                  )}
                </button>

                <button
                  className={`control-btn tooltip ${!isVideoEnabled ? 'video-off' : ''} ${!hasCamera ? 'disabled' : ''}`}
                  data-tooltip={!hasCamera ? 'No Camera' : (isVideoEnabled ? 'Stop Camera' : 'Start Camera')}
                  onClick={toggleCamera}
                >
                  {isVideoEnabled ? (
                    <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24"><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/></svg>
                  )}
                </button>
              </div>

              <div className="lobby-actions">
                <button className="btn btn-primary join-btn" onClick={joinRoom}>
                  Join Room
                </button>
                <button className="btn btn-secondary cancel-btn" onClick={() => router.push('/')}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : status === 'waiting-room' ? (
          <div className="lobby-screen waiting-room-overlay">
            <div className="waiting-card glass">
              <div className="waiting-icon-container">
                <div className="pulse-circle"></div>
                <div className="icon-inner">
                  <svg viewBox="0 0 24 24" width="48" height="48">
                    <path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                  </svg>
                </div>
              </div>
              <h2 className="waiting-title">Waiting to be admitted...</h2>
              <div className="waiting-details">
                <p>Hi <strong>{user?.username}</strong>, the host has been notified that you're waiting.</p>
                <div className="status-badge">
                  <span className="status-dot-pulse"></span>
                  Please wait a moment
                </div>
              </div>
              <div className="waiting-actions">
                <button className="btn btn-secondary exit-btn" onClick={endCall}>
                  Leave Meeting
                </button>
              </div>
            </div>
          </div>
        ) : status === 'rejected' ? (
          <div className="lobby-screen rejected">
            <div className="waiting-content" style={{ textAlign: 'center', padding: '40px' }}>
              <h2 className="lobby-title" style={{ color: '#ff4b4b' }}>Access Denied</h2>
              <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: '10px' }}>
                You were not admitted to this meeting or the meeting has ended.
              </p>
              <button className="btn btn-primary" onClick={() => router.replace('/')} style={{ marginTop: '30px' }}>
                Go Home
              </button>
            </div>
          </div>
        ) : (
          <div className="call-screen active">
            {/* Waiting Users Popup for Admin */}
            {socketRef.current?.id === adminSocketId && waitingUsers.length > 0 && (
              <div className="waiting-users-overlay">
                <div className="waiting-users-card">
                  <h4>People waiting to join ({waitingUsers.length})</h4>
                  <div className="waiting-list">
                    {waitingUsers.map(u => (
                      <div key={u.socketId} className="waiting-item">
                        <span>{u.username}</span>
                        <div className="waiting-item-actions">
                          <button className="btn-admit" onClick={() => admitUser(u.socketId)}>Admit</button>
                          <button className="btn-reject" onClick={() => rejectUser(u.socketId)}>Deny</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="connection-status">
              <span className={`status-dot ${status}`} />
              <span>
                {status === 'idle' && 'Disconnected'}
                {status === 'connecting' && 'Connecting to SFU...'}
                {status === 'waiting' && 'Waiting for others...'}
                {status === 'connected' && `Connected · ${remotePeers.length + 1} participants`}
              </span>
            </div>

            <div className="video-grid" style={{ gridTemplateColumns: remotePeers.length > 0 ? 'repeat(auto-fit, minmax(300px, 1fr))' : '1fr' }}>
              {remotePeers.map(peer => (
                <RemoteVideo key={peer.socketId} peer={peer} isAdmin={peer.socketId === adminSocketId} />
              ))}

              {/* Local video */}
              <div className="video-container local">
                <div className="video-placeholder" style={{ display: isVideoEnabled ? 'none' : 'flex' }}>
                  <div className="avatar">
                    <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  </div>
                  <span className="name">{user?.username} (You)</span>
                </div>
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ display: isVideoEnabled ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                />
                <div className="video-label">
                  <span className="status-dot connected" />
                  You
                  {socketRef.current?.id === adminSocketId && <span className="admin-badge">Host</span>}
                  {!isAudioEnabled && (
                    <span className="mute-indicator-icon">
                      <svg viewBox="0 0 24 24"><path fill="#ff4b4b" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Room invite link */}
            <div className="room-panel" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="room-info" style={{ flex: 1, overflow: 'hidden' }}>
                <div className="room-label">🔗 Invite Link</div>
                <div className="room-id" style={{ fontSize: '0.8rem', opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {getRoomUrl()}
                </div>
              </div>
              <button className="btn btn-secondary copy-btn" onClick={copyRoomUrl} style={{ flexShrink: 0 }}>
                {isCopied ? '✓ Copied!' : 'Copy Link'}
              </button>
            </div>

            {/* Controls */}
            <div className="call-controls">
              <button
                className={`control-btn tooltip ${!isAudioEnabled ? 'muted' : ''}`}
                data-tooltip={isAudioEnabled ? 'Mute' : 'Unmute'}
                onClick={toggleMic}
              >
                {isAudioEnabled ? (
                  <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>
                )}
              </button>

              <button
                className={`control-btn tooltip ${!isVideoEnabled ? 'video-off' : ''}`}
                data-tooltip={isVideoEnabled ? 'Stop Camera' : 'Start Camera'}
                onClick={toggleCamera}
              >
                {isVideoEnabled ? (
                  <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24"><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/></svg>
                )}
              </button>

              <button className="control-btn end-call tooltip" data-tooltip="Leave Room" onClick={endCall}>
                <svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* Error Modal */}
        <div className={`error-modal ${error ? 'active' : ''}`} onClick={() => setError(null)}>
          <div className="error-content" onClick={e => e.stopPropagation()}>
            <h3>{error?.title}</h3>
            <p>{error?.message}</p>
            <button className="btn btn-primary" onClick={() => setError(null)}>OK</button>
          </div>
        </div>
      </div>
    </>
  )
}
