'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { loadSettings, buildVideoConstraints, buildAudioConstraints } from '@/lib/settings'

type ConnectionStatus = 'idle' | 'waiting' | 'connecting' | 'connected'

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
  const [roomState, setRoomState] = useState<any>(null)

  // Media state
  const [isAudioEnabled, setIsAudioEnabled] = useState(true)
  const [isVideoEnabled, setIsVideoEnabled] = useState(true)

  // WebRTC refs
  const peerRef = useRef<any>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const connectionsRef = useRef<{ [key: string]: any }>({})
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const [remotePeers, setRemotePeers] = useState<{ userId: string; username: string; stream: MediaStream }[]>([])

  // My actual PeerJS peer ID (may have a session suffix if original was taken)
  const myPeerIdRef = useRef<string>('')

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
        // Not logged in — redirect to home with roomId pre-filled
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

  // ---- On page unload, leave room ----
  useEffect(() => {
    const handleUnload = () => {
      if (roomId) navigator.sendBeacon(`/api/rooms/${roomId}/leave`)
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [roomId])

  const getMediaStream = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setIsVideoEnabled(false)
      setIsAudioEnabled(false)
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
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false })
          setIsAudioEnabled(false)
          return stream
        } catch {
          setIsVideoEnabled(false)
          setIsAudioEnabled(false)
          return new MediaStream()
        }
      }
    }
  }

  // Cap bitrates based on user settings
  const applyBandwidthCap = async (pc: RTCPeerConnection) => {
    try {
      const settings = loadSettings()
      const senders = pc.getSenders()
      for (const sender of senders) {
        if (!sender.track) continue
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        if (sender.track.kind === 'video') {
          params.encodings[0].maxBitrate = settings.maxVideoBitrate * 1000
          params.encodings[0].scaleResolutionDownBy = 1
        } else if (sender.track.kind === 'audio') {
          params.encodings[0].maxBitrate = settings.maxAudioBitrate * 1000
        }
        await sender.setParameters(params)
      }
    } catch (e) {
      console.warn('[BW] Could not apply bandwidth cap:', e)
    }
  }

  const initPeerJS = (userId: string, stream: MediaStream): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      const { Peer } = await import('peerjs')

      const tryConnect = (peerId: string, retries = 3) => {
        const peer = new Peer(peerId, {
          debug: 1,
          config: {
            iceServers: [
              // STUN — discovers public IPs
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              // TURN — relays traffic when direct path fails (cross-network, mobile, strict NAT)
              { urls: 'turn:openrelay.metered.ca:80',          username: 'openrelayproject', credential: 'openrelayproject' },
              { urls: 'turn:openrelay.metered.ca:443',         username: 'openrelayproject', credential: 'openrelayproject' },
              { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
            ],
            iceCandidatePoolSize: 10,
          },
        })
        peerRef.current = peer

        peer.on('open', () => {
          console.log('[PeerJS] Connected as:', peerId)
          myPeerIdRef.current = peerId
          resolve(peerId)
        })

        peer.on('call', (incomingCall: any) => {
          console.log('[PeerJS] Incoming call from:', incomingCall.peer)
          incomingCall.answer(stream)
          handleCall(incomingCall, stream)
        })

        peer.on('error', (err: any) => {
          if (err.type === 'unavailable-id' && retries > 0) {
            console.warn('[PeerJS] ID taken, retrying with new ID...')
            peer.destroy()
            // Append a short random suffix to make the ID unique
            const newId = `${userId}_${Math.random().toString(36).slice(2, 6)}`
            setTimeout(() => tryConnect(newId, retries - 1), 500)
          } else {
            console.error('[PeerJS] Fatal error:', err)
            reject(err)
          }
        })
      }

      tryConnect(userId)
    })
  }

  const handleCall = (call: any, localStream: MediaStream) => {
    const remoteUserId = call.peer
    if (connectionsRef.current[remoteUserId]) return
    connectionsRef.current[remoteUserId] = call

    call.on('stream', (remoteStream: MediaStream) => {
      console.log('[PeerJS] Received stream from:', remoteUserId)
      setRemotePeers(prev => {
        if (prev.find(p => p.userId === remoteUserId)) return prev
        return [...prev, { userId: remoteUserId, username: 'Loading...', stream: remoteStream }]
      })
      setStatus('connected')

      // Apply bandwidth cap once the underlying RTCPeerConnection is established
      if (call.peerConnection) {
        applyBandwidthCap(call.peerConnection)
      }
    })

    call.on('close', () => {
      delete connectionsRef.current[remoteUserId]
      setRemotePeers(prev => prev.filter(p => p.userId !== remoteUserId))
    })

    call.on('error', () => {
      delete connectionsRef.current[remoteUserId]
      setRemotePeers(prev => prev.filter(p => p.userId !== remoteUserId))
    })
  }

  const callPeer = (remotePeerId: string, stream: MediaStream) => {
    if (!peerRef.current || connectionsRef.current[remotePeerId]) return
    console.log('[PeerJS] Calling peer:', remotePeerId)
    const call = peerRef.current.call(remotePeerId, stream)
    if (call) handleCall(call, stream)
  }

  const pollRoomState = async (stream: MediaStream) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError({ title: 'Room Closed', message: 'This room no longer exists.' })
          setTimeout(() => router.replace('/'), 2500)
        }
        return
      }
      const data = await res.json()
      setRoomState(data.room)

      // peerIds: { [userId]: peerId }
      const peerIds: Record<string, string> = data.peerIds || {}

      // Sync usernames
      setRemotePeers(prev => prev.map(peer => {
        const p = data.room.participants.find((p: any) => p._id === peer.userId)
        return p ? { ...peer, username: p.username } : peer
      }))

      // Connect to any new participants using their registered peerId
      let hasOthers = false
      data.room.participants.forEach((p: any) => {
        if (p._id !== user.id) {
          hasOthers = true
          const remotePeerId = peerIds[p._id] || p._id
          if (!connectionsRef.current[remotePeerId]) {
            callPeer(remotePeerId, stream)
          }
        }
      })

      if (!hasOthers) setStatus(prev => prev !== 'idle' ? 'waiting' : prev)
    } catch (err) {
      console.error('Poll error:', err)
    }
  }

  const initCall = async () => {
    try {
      const stream = await getMediaStream()
      localStreamRef.current = stream

      // Attach local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      // Connect to PeerJS — get our actual peer ID (may have suffix if original was taken)
      const myPeerId = await initPeerJS(user.id, stream)

      // Join or create room, sending our peerId so others can call us
      const joinRes = await fetch(`/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: myPeerId })
      })

      if (!joinRes.ok) {
        const d = await joinRes.json()
        if (joinRes.status === 404) {
          // Room doesn't exist yet — create it
          const createRes = await fetch('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId })
          })
          if (!createRes.ok) {
            const cd = await createRes.json()
            throw new Error(cd.error || 'Failed to create room')
          }
          // Save our peerId after creating
          await fetch(`/api/rooms/${roomId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peerId: myPeerId })
          })
          setStatus('waiting')
        } else {
          throw new Error(d.error || 'Failed to join room')
        }
      } else {
        setStatus('connecting')
      }

      // Start polling
      await pollRoomState(stream)
      pollIntervalRef.current = setInterval(() => pollRoomState(stream), 3000)

    } catch (err: any) {
      setError({ title: 'Error', message: err.message })
    }
  }

  const cleanup = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    Object.values(connectionsRef.current).forEach((call: any) => call.close())
    connectionsRef.current = {}
    if (peerRef.current) peerRef.current.destroy()
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop())
    fetch(`/api/rooms/${roomId}/leave`, { method: 'POST' }).catch(() => {})
  }

  const endCall = async () => {
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

  const isLocalAdmin = roomState?.adminId?._id === user?.id || roomState?.adminId === user?.id

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

      ref.current.onloadedmetadata = () => {
        setHasVideo(peer.stream.getVideoTracks().length > 0)
      }

      return () => {
        peer.stream.removeEventListener('addtrack', checkTracks)
        peer.stream.removeEventListener('removetrack', checkTracks)
      }
    }, [peer.stream])

    const isAdmin = roomState?.adminId?._id === peer.userId || roomState?.adminId === peer.userId

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
          {peer.username} {isAdmin ? '(Admin)' : ''}
        </div>
      </div>
    )
  }

  if (isAuthLoading) {
    return (
      <div className="container">
        <div style={{ textAlign: 'center', marginTop: '100px', color: 'white' }}>Loading...</div>
      </div>
    )
  }

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

        {/* Call Screen */}
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
            {/* Remote Peers */}
            {remotePeers.map(peer => (
              <RemoteVideo key={peer.userId} peer={peer} />
            ))}

            {/* Local Video */}
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
                You {isLocalAdmin ? '(Admin)' : ''}
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
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    Copy Link
                  </>
                )}
              </button>
            </div>
          </div>

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
              data-tooltip={isVideoEnabled ? 'Disable Camera' : 'Enable Camera'}
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

        {/* Error Modal */}
        <div className={`error-modal ${error ? 'active' : ''}`} onClick={() => setError(null)}>
          <div className="error-content" onClick={(e) => e.stopPropagation()}>
            <h3>{error?.title}</h3>
            <p>{error?.message}</p>
            <button className="btn btn-primary" onClick={() => setError(null)}>OK</button>
          </div>
        </div>
      </div>
    </>
  )
}
