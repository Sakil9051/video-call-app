'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import { loadSettings, buildVideoConstraints, buildAudioConstraints } from '@/lib/settings'

type ConnectionStatus = 'idle' | 'waiting' | 'connecting' | 'connected'

const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001'

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
}

export default function RoomPage() {
  const params = useParams()
  const router = useRouter()
  const roomId = (params.roomId as string).toUpperCase()

  // Auth state
  const [user, setUser] = useState<any>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  // Call state
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [isCopied, setIsCopied] = useState(false)

  // Media state
  const [isAudioEnabled, setIsAudioEnabled] = useState(true)
  const [isVideoEnabled, setIsVideoEnabled] = useState(true)

  // WebRTC refs
  const socketRef = useRef<Socket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const peersRef = useRef<{ [socketId: string]: RTCPeerConnection }>({})
  
  const [remotePeers, setRemotePeers] = useState<{ socketId: string; userId: string; username: string; stream: MediaStream | null }[]>([])

  // ---- Auth check ----
  useEffect(() => {
    const cachedUser = sessionStorage.getItem('user')
    if (cachedUser) {
      try {
        setUser(JSON.parse(cachedUser))
        setIsAuthLoading(false)
        return
      } catch (e) {}
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

  // ---- Initialize call once user is ready ----
  useEffect(() => {
    if (!user || isAuthLoading) return
    initCall()
    return () => cleanup()
  }, [user, isAuthLoading])

  const getMediaStream = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setIsVideoEnabled(false); setIsAudioEnabled(false)
      return new MediaStream()
    }
    const s = loadSettings()
    const videoConstraints = buildVideoConstraints(s)
    const audioConstraints = buildAudioConstraints(s)

    try {
      return await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: audioConstraints })
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints })
        setIsVideoEnabled(false)
        return stream
      } catch {
        setIsVideoEnabled(false); setIsAudioEnabled(false)
        return new MediaStream()
      }
    }
  }

  // Dynamic Bandwidth Cap based on number of users
  const applyBandwidthCap = async (pc: RTCPeerConnection) => {
    try {
      const settings = loadSettings()
      // If there are many people, lower the bitrate aggressively to prevent lag
      const numPeers = Object.keys(peersRef.current).length
      let maxVideo = settings.maxVideoBitrate * 1000
      let maxAudio = settings.maxAudioBitrate * 1000
      
      if (numPeers >= 3) { maxVideo = Math.min(maxVideo, 300_000); maxAudio = 32_000 }
      else if (numPeers >= 2) { maxVideo = Math.min(maxVideo, 500_000); maxAudio = 48_000 }

      const senders = pc.getSenders()
      for (const sender of senders) {
        if (!sender.track) continue
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        if (sender.track.kind === 'video') {
          params.encodings[0].maxBitrate = maxVideo
          params.encodings[0].scaleResolutionDownBy = numPeers >= 3 ? 2 : 1 // Drop resolution if many peers
        } else if (sender.track.kind === 'audio') {
          params.encodings[0].maxBitrate = maxAudio
        }
        await sender.setParameters(params)
      }
    } catch (e) {
      console.warn('[BW] Could not apply bandwidth cap:', e)
    }
  }

  const createPeerConnection = (targetSocketId: string, remoteUserId: string, remoteUsername: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS)
    peersRef.current[targetSocketId] = pc

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('signal', {
          targetSocketId,
          callerId: user.id,
          callerUsername: user.username,
          signal: { type: 'candidate', candidate: event.candidate }
        })
      }
    }

    pc.ontrack = (event) => {
      setRemotePeers(prev => {
        const existing = prev.find(p => p.socketId === targetSocketId)
        if (existing && existing.stream) {
          // If stream already exists, just add track (if needed, though usually ontrack provides the whole stream)
          return prev
        }
        const newPeers = prev.filter(p => p.socketId !== targetSocketId)
        return [...newPeers, { socketId: targetSocketId, userId: remoteUserId, username: remoteUsername, stream: event.streams[0] }]
      })
      setStatus('connected')
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        removePeer(targetSocketId)
      }
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!)
      })
    }

    return pc
  }

  const removePeer = (socketId: string) => {
    if (peersRef.current[socketId]) {
      peersRef.current[socketId].close()
      delete peersRef.current[socketId]
    }
    setRemotePeers(prev => prev.filter(p => p.socketId !== socketId))
    if (Object.keys(peersRef.current).length === 0) setStatus('waiting')
  }

  const initCall = async () => {
    try {
      setStatus('connecting')
      const stream = await getMediaStream()
      localStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream

      // 1. Connect to Socket
      const socket = io(SIGNALING_URL)
      socketRef.current = socket

      socket.on('connect', () => {
        socket.emit('join-room', { roomId, userId: user.id, username: user.username })
        setStatus('waiting')
      })

      // 2. Receive users already in room -> Initiate calls to them
      socket.on('room-users', async (users: any[]) => {
        if (users.length > 0) setStatus('connecting')
        for (const u of users) {
          const pc = createPeerConnection(u.socketId, u.userId, u.username)
          await applyBandwidthCap(pc)
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          socket.emit('signal', {
            targetSocketId: u.socketId,
            callerId: user.id,
            callerUsername: user.username,
            signal: { type: 'offer', sdp: offer }
          })
        }
      })

      // 3. New user joined -> Wait for their offer, but add placeholder
      socket.on('user-joined', (u: any) => {
        setRemotePeers(prev => [...prev, { socketId: u.socketId, userId: u.userId, username: u.username, stream: null }])
      })

      // 4. Handle incoming signals
      socket.on('signal', async (data: any) => {
        const { senderSocketId, senderUserId, senderUsername, signal } = data
        let pc = peersRef.current[senderSocketId]

        if (signal.type === 'offer') {
          if (!pc) pc = createPeerConnection(senderSocketId, senderUserId, senderUsername)
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
          await applyBandwidthCap(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          socket.emit('signal', {
            targetSocketId: senderSocketId,
            callerId: user.id,
            callerUsername: user.username,
            signal: { type: 'answer', sdp: answer }
          })
        } else if (signal.type === 'answer') {
          if (pc) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
        } else if (signal.type === 'candidate') {
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {})
          }
        }
      })

      // 5. User left
      socket.on('user-left', (u: any) => {
        removePeer(u.socketId)
      })

    } catch (err: any) {
      setError({ title: 'Error', message: err.message })
    }
  }

  const cleanup = () => {
    Object.values(peersRef.current).forEach(pc => pc.close())
    peersRef.current = {}
    if (socketRef.current) socketRef.current.disconnect()
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop())
  }

  const endCall = () => {
    cleanup()
    router.replace('/')
  }

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) { track.enabled = !track.enabled; setIsAudioEnabled(track.enabled) }
  }

  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) { track.enabled = !track.enabled; setIsVideoEnabled(track.enabled) }
  }

  const getRoomUrl = () => `${window.location.origin}/room/${roomId}`

  const copyRoomUrl = () => {
    navigator.clipboard.writeText(getRoomUrl()).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2500)
    })
  }

  // ---- Remote video component ----
  const RemoteVideo = ({ peer }: { peer: any }) => {
    const ref = useRef<HTMLVideoElement>(null)
    const [hasVideo, setHasVideo] = useState(false)

    useEffect(() => {
      if (!ref.current || !peer.stream) return
      ref.current.srcObject = peer.stream
      const checkTracks = () => {
        const videoTracks = peer.stream.getVideoTracks()
        setHasVideo(videoTracks.length > 0 && videoTracks[0].enabled && videoTracks[0].readyState === 'live')
      }
      checkTracks()
      peer.stream.addEventListener('addtrack', checkTracks)
      peer.stream.addEventListener('removetrack', checkTracks)
      ref.current.onloadedmetadata = () => setHasVideo(peer.stream.getVideoTracks().length > 0)
      return () => {
        peer.stream.removeEventListener('addtrack', checkTracks)
        peer.stream.removeEventListener('removetrack', checkTracks)
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
        <video ref={ref} autoPlay playsInline style={{ display: hasVideo ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover' }} />
        <div className="video-label">
          <span className="status-dot connected" />
          {peer.username}
        </div>
      </div>
    )
  }

  if (isAuthLoading) return <div className="container"><div style={{ textAlign: 'center', marginTop: '100px', color: 'white' }}>Loading...</div></div>

  return (
    <>
      <div className="background-mesh" />
      <div className="container">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div className="logo">
              <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
            </div>
            <h1>PeerConnect</h1>
          </div>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'rgba(255,255,255,0.8)' }}>
              <span>Welcome, <strong>{user.username}</strong></span>
            </div>
          )}
        </header>

        <div className="call-screen active">
          <div className="connection-status">
            <span className={`status-dot ${status}`} />
            <span>
              {status === 'waiting' && 'Waiting for others to join...'}
              {status === 'connecting' && 'Connecting...'}
              {status === 'connected' && `Connected (${remotePeers.length + 1} participants)`}
              {status === 'idle' && 'Connecting...'}
            </span>
          </div>

          <div className="video-grid" style={{ gridTemplateColumns: remotePeers.length > 0 ? 'repeat(auto-fit, minmax(300px, 1fr))' : '1fr' }}>
            {remotePeers.map(peer => (
              <RemoteVideo key={peer.socketId} peer={peer} />
            ))}

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
                style={{ display: isVideoEnabled ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div className="video-label">
                <span className="status-dot connected" />
                You
              </div>
            </div>
          </div>

          <div className="room-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="room-info" style={{ flex: 1, overflow: 'hidden' }}>
                <div className="room-label">🔗 Invite Link</div>
                <div className="room-id" style={{ fontSize: '0.8rem', opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {typeof window !== 'undefined' ? getRoomUrl() : ''}
                </div>
              </div>
              <button className="btn btn-secondary copy-btn" onClick={copyRoomUrl} style={{ flexShrink: 0 }}>
                {isCopied ? (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Copied!</>
                ) : (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> Copy Link</>
                )}
              </button>
            </div>
          </div>

          <div className="call-controls">
            <button className={`control-btn tooltip ${!isAudioEnabled ? 'muted' : ''}`} data-tooltip={isAudioEnabled ? 'Mute' : 'Unmute'} onClick={toggleMic}>
              {isAudioEnabled ? (
                <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>
              )}
            </button>
            <button className={`control-btn tooltip ${!isVideoEnabled ? 'video-off' : ''}`} data-tooltip={isVideoEnabled ? 'Disable Camera' : 'Enable Camera'} onClick={toggleCamera}>
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
      </div>
    </>
  )
}
