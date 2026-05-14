'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

type ConnectionStatus = 'idle' | 'waiting' | 'connecting' | 'connected' | 'disconnected'

export default function Home() {
  // Auth state
  const [user, setUser] = useState<any>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [showAuth, setShowAuth] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // Call state
  const [isInCall, setIsInCall] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [joinRoomId, setJoinRoomId] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  
  // Media state
  const [isAudioEnabled, setIsAudioEnabled] = useState(true)
  const [isVideoEnabled, setIsVideoEnabled] = useState(true)
  
  // Room state from DB
  const [roomState, setRoomState] = useState<any>(null)
  
  // WebRTC & PeerJS refs
  const peerRef = useRef<any>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  
  // Map of userId -> MediaConnection
  const connectionsRef = useRef<{ [key: string]: any }>({})
  // Array of remote streams to render
  const [remotePeers, setRemotePeers] = useState<{ userId: string; username: string; stream: MediaStream }[]>([])
  
  // Polling interval ref
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Auth Functions
  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
      } else {
        setUser(null)
      }
    } catch (e) {
      setUser(null)
    } finally {
      setIsAuthLoading(false)
    }
  }

  useEffect(() => {
    fetchUser()
  }, [])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Authentication failed')
      
      setUser(data.user)
      setUsername('')
      setPassword('')
    } catch (err: any) {
      setError({ title: 'Authentication Error', message: err.message })
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    if (isInCall) endCall()
  }

  // Initial Hash check
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash && hash.length === 6) {
      setJoinRoomId(hash)
    }
  }, [])

  const generateRoomId = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let result = ''
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  const getMediaStream = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setIsVideoEnabled(false)
      setIsAudioEnabled(false)
      return new MediaStream()
    }
    
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch (err: any) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
        setIsVideoEnabled(false)
        return stream
      } catch (err2: any) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          setIsAudioEnabled(false)
          return stream
        } catch (err3: any) {
          setIsVideoEnabled(false)
          setIsAudioEnabled(false)
          return new MediaStream()
        }
      }
    }
  }

  // --- WebRTC Logic ---

  const initPeerJS = async (userId: string, stream: MediaStream) => {
    const { Peer } = await import('peerjs')
    const peer = new Peer(userId, { debug: 1 })
    peerRef.current = peer

    peer.on('open', () => {
      console.log('PeerJS connected as:', userId)
    })

    peer.on('call', (incomingCall: any) => {
      console.log('Incoming call from:', incomingCall.peer)
      incomingCall.answer(stream)
      handleCall(incomingCall)
    })

    peer.on('error', (err: any) => {
      console.error('Peer error:', err)
      // PeerJS ID taken or disconnected
    })
  }

  const handleCall = (call: any) => {
    const remoteUserId = call.peer
    if (connectionsRef.current[remoteUserId]) return // Already connected
    
    connectionsRef.current[remoteUserId] = call

    call.on('stream', (remoteStream: MediaStream) => {
      console.log('Received stream from:', remoteUserId)
      setRemotePeers(prev => {
        // Prevent duplicate streams for same user
        if (prev.find(p => p.userId === remoteUserId)) return prev
        return [...prev, { userId: remoteUserId, username: 'Loading...', stream: remoteStream }]
      })
      setStatus('connected')
    })

    call.on('close', () => {
      console.log('Call closed:', remoteUserId)
      delete connectionsRef.current[remoteUserId]
      setRemotePeers(prev => prev.filter(p => p.userId !== remoteUserId))
    })

    call.on('error', (err: any) => {
      console.error('Call error:', err)
      delete connectionsRef.current[remoteUserId]
      setRemotePeers(prev => prev.filter(p => p.userId !== remoteUserId))
    })
  }

  const callPeer = (remoteUserId: string, stream: MediaStream) => {
    if (!peerRef.current || connectionsRef.current[remoteUserId]) return
    console.log('Calling peer:', remoteUserId)
    const call = peerRef.current.call(remoteUserId, stream)
    if (call) handleCall(call)
  }

  const pollRoomState = async (roomIdToPoll: string, currentStream: MediaStream) => {
    try {
      const res = await fetch(`/api/rooms/${roomIdToPoll}`)
      if (!res.ok) {
        if (res.status === 404) {
           // Room deleted or ended
           endCall()
           setError({ title: 'Room Closed', message: 'The room has been closed.' })
        }
        return
      }
      
      const data = await res.json()
      setRoomState(data.room)

      // Sync usernames for existing remote streams
      setRemotePeers(prev => prev.map(peer => {
        const participant = data.room.participants.find((p: any) => p._id === peer.userId)
        if (participant && peer.username !== participant.username) {
          return { ...peer, username: participant.username }
        }
        return peer
      }))

      // Initiate calls to any participants we aren't connected to yet
      data.room.participants.forEach((p: any) => {
        if (p._id !== user.id && !connectionsRef.current[p._id]) {
          callPeer(p._id, currentStream)
        }
      })
      
    } catch (err) {
      console.error('Error polling room state:', err)
    }
  }

  // --- Room API Interaction ---

  const createRoom = async () => {
    const newRoomId = generateRoomId()
    
    try {
      // Create room in DB
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: newRoomId })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create room')

      setRoomId(newRoomId)
      setRoomState(data.room)
      setStatus('waiting')

      const stream = await getMediaStream()
      localStreamRef.current = stream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      await initPeerJS(user.id, stream)
      setIsInCall(true)
      window.location.hash = newRoomId

      // Start polling
      pollIntervalRef.current = setInterval(() => pollRoomState(newRoomId, stream), 3000)

    } catch (err: any) {
      setError({ title: 'Error', message: err.message })
    }
  }

  const joinRoom = async () => {
    const roomIdVal = joinRoomId.toUpperCase().trim()
    if (!roomIdVal || roomIdVal.length !== 6) {
      setError({ title: 'Invalid Room ID', message: 'Please enter a valid 6-character room ID.' })
      return
    }

    try {
      // Join room in DB
      const res = await fetch(`/api/rooms/${roomIdVal}/join`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to join room')

      setRoomId(roomIdVal)
      setStatus('connecting')

      const stream = await getMediaStream()
      localStreamRef.current = stream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      await initPeerJS(user.id, stream)
      setIsInCall(true)
      window.location.hash = roomIdVal

      // Start polling and fetch immediate state
      pollRoomState(roomIdVal, stream)
      pollIntervalRef.current = setInterval(() => pollRoomState(roomIdVal, stream), 3000)

    } catch (err: any) {
      setError({ title: 'Error', message: err.message })
    }
  }

  const endCall = async () => {
    // Leave room in DB
    if (roomId) {
      fetch(`/api/rooms/${roomId}/leave`, { method: 'POST' }).catch(console.error)
    }

    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)

    Object.values(connectionsRef.current).forEach(call => call.close())
    connectionsRef.current = {}
    setRemotePeers([])

    if (peerRef.current) peerRef.current.destroy()
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop())

    peerRef.current = null
    localStreamRef.current = null
    setRoomId('')
    setRoomState(null)
    setStatus('idle')
    setIsAudioEnabled(true)
    setIsVideoEnabled(true)
    history.replaceState(null, '', window.location.pathname)
    setIsInCall(false)
  }

  // Handle unload to properly leave room
  useEffect(() => {
    const handleUnload = () => {
      if (roomId && isInCall) {
        navigator.sendBeacon(`/api/rooms/${roomId}/leave`)
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [roomId, isInCall])

  // --- Controls ---

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsAudioEnabled(audioTrack.enabled)
      }
    }
  }

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setIsVideoEnabled(videoTrack.enabled)
      }
    }
  }

  const copyRoomId = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId).then(() => {
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
      })
    }
  }

  const closeError = () => setError(null)

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') joinRoom()
  }

  // --- Video Component for Remote Peers ---
  const RemoteVideo = ({ peer }: { peer: any }) => {
    const ref = useRef<HTMLVideoElement>(null)
    useEffect(() => {
      if (ref.current) ref.current.srcObject = peer.stream
    }, [peer.stream])

    // Check if this peer is the admin
    const isAdmin = roomState?.adminId?._id === peer.userId || roomState?.adminId === peer.userId

    return (
      <div className="video-container remote connected">
        <video ref={ref} autoPlay playsInline />
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

  // Check if current user is admin
  const isLocalAdmin = roomState?.adminId?._id === user?.id || roomState?.adminId === user?.id

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
              <button onClick={handleLogout} className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>Logout</button>
            </div>
          )}
        </header>

        {!user ? (
          !showAuth ? (
            <div className="landing-page-scroll">
            <div className="hero-section">
              <div className="hero-content">
                <h2>Connect Instantly with<br/><span className="highlight">Anyone, Anywhere.</span></h2>
                <p>PeerConnect is a blazing fast, peer-to-peer video calling platform. Create a room instantly, share the code, and start talking securely in high definition without any downloads.</p>
                <div className="hero-actions">
                  <button className="btn btn-primary btn-large" onClick={() => setShowAuth(true)}>Get Started for Free</button>
                </div>
                <div className="hero-features">
                  <div className="feature">
                    <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
                    <span>Secure P2P</span>
                  </div>
                  <div className="feature">
                    <svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-10-7h9v6h-9z"/></svg>
                    <span>Multi-User Rooms</span>
                  </div>
                  <div className="feature">
                    <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
                    <span>No Downloads</span>
                  </div>
                </div>
              </div>
              
              <div className="hero-visual">
                <div className="mockup-card">
                  <div className="mockup-header">
                    <div className="dot red"></div>
                    <div className="dot yellow"></div>
                    <div className="dot green"></div>
                  </div>
                  <div className="mockup-body">
                    <div className="mockup-video-grid">
                      <div className="mock-video mock-1">
                        <div className="mock-label">You</div>
                      </div>
                      <div className="mock-video mock-2">
                        <div className="mock-label">Sarah</div>
                      </div>
                      <div className="mock-video mock-3">
                        <div className="mock-label">Mike (Admin)</div>
                      </div>
                      <div className="mock-video mock-4">
                        <div className="mock-label">Jessica</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            
            <section id="features" className="info-section">
              <div className="section-header">
                <h2>Why Choose PeerConnect?</h2>
                <p>Everything you need for seamless communication, built right in.</p>
              </div>
              <div className="features-grid">
                <div className="feature-card">
                  <div className="icon">🚀</div>
                  <h3>Blazing Fast</h3>
                  <p>Direct peer-to-peer connections mean minimal latency and crystal clear video quality.</p>
                </div>
                <div className="feature-card">
                  <div className="icon">🔒</div>
                  <h3>Secure & Private</h3>
                  <p>Your video streams are encrypted end-to-end between peers without middleman servers.</p>
                </div>
                <div className="feature-card">
                  <div className="icon">👥</div>
                  <h3>Multi-User Support</h3>
                  <p>Invite multiple friends or colleagues into a dynamic video grid that scales seamlessly.</p>
                </div>
                <div className="feature-card">
                  <div className="icon">👑</div>
                  <h3>Smart Admin Controls</h3>
                  <p>Automatic admin assignment ensures rooms are always managed, even if the creator leaves.</p>
                </div>
              </div>
            </section>

            <section className="info-section alternate">
              <div className="section-header">
                <h2>How It Works</h2>
                <p>Get started in three simple steps.</p>
              </div>
              <div className="steps-container">
                <div className="step">
                  <div className="step-number">1</div>
                  <h3>Create an Account</h3>
                  <p>Sign up in seconds. It's completely free and helps us keep the platform secure.</p>
                </div>
                <div className="step-connector"></div>
                <div className="step">
                  <div className="step-number">2</div>
                  <h3>Generate a Room</h3>
                  <p>Click 'Create Room' to generate a unique, secure 6-character code.</p>
                </div>
                <div className="step-connector"></div>
                <div className="step">
                  <div className="step-number">3</div>
                  <h3>Share & Connect</h3>
                  <p>Share the code with anyone. They just paste it in and instantly join your call!</p>
                </div>
              </div>
            </section>

            <footer className="footer">
              <div className="footer-content">
                <div className="logo-section">
                  <div className="logo-small">
                    <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                  </div>
                  <span>PeerConnect</span>
                </div>
                <p>&copy; {new Date().getFullYear()} PeerConnect. Built with Next.js, WebRTC, and MongoDB.</p>
              </div>
            </footer>
            </div>
          ) : (
            <div className="auth-wrapper">
            <div className="auth-card">
              <div className="auth-header">
                <h2>{authMode === 'login' ? 'Welcome Back' : 'Join PeerConnect'}</h2>
                <p>{authMode === 'login' ? 'You must be signed in to create or join a room.' : 'Create an account to start hosting video calls.'}</p>
              </div>
              
              <form onSubmit={handleAuth} className="auth-form">
                <div className="input-group">
                  <label>Username</label>
                  <input 
                    type="text" 
                    placeholder="Enter your username" 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Password</label>
                  <input 
                    type="password" 
                    placeholder="Enter your password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary auth-submit">
                  {authMode === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              </form>
              
              <div className="auth-footer">
                <p>
                  {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
                  <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
                    {authMode === 'login' ? 'Sign up' : 'Sign in'}
                  </button>
                </p>
              </div>
            </div>
          </div>
          )
        ) : (
          <>
            {/* Welcome Screen */}
            <div className={`welcome-screen ${isInCall ? 'hidden' : ''}`}>
              <div className="welcome-content">
                <h2>Start a Video Call</h2>
                <p>Create a room and share the link, or join an existing room.</p>
              </div>

              <div className="action-cards">
                <div className="action-card" onClick={createRoom}>
                  <div className="icon">
                    <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                  </div>
                  <h3>Create Room</h3>
                  <p>Generate a new room and wait for someone to join</p>
                </div>

                <div className="action-card">
                  <div className="icon">
                    <svg viewBox="0 0 24 24"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  </div>
                  <h3>Join Room</h3>
                  <p>Enter a room ID to join an existing call</p>
                  <div className="join-form">
                    <input
                      type="text"
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                      placeholder="Enter room ID"
                      maxLength={6}
                      onKeyPress={handleKeyPress}
                    />
                    <button className="btn btn-primary" onClick={joinRoom}>Join</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Call Screen */}
            <div className={`call-screen ${isInCall ? 'active' : ''}`}>
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
                  <video ref={localVideoRef} autoPlay playsInline muted style={{ display: isVideoEnabled ? 'block' : 'none' }} />
                  <div className="video-label">
                    <span className="status-dot connected" />
                    You {isLocalAdmin ? '(Admin)' : ''}
                  </div>
                </div>
              </div>

              <div className="room-panel" style={{ display: 'flex' }}>
                <div className="room-info">
                  <div className="room-label">Room ID</div>
                  <div className="room-id">{roomId}</div>
                </div>
                <button className="btn btn-secondary copy-btn" onClick={copyRoomId}>
                  {isCopied ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                      Copy
                    </>
                  )}
                </button>
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
          </>
        )}

        {/* Error Modal */}
        <div className={`error-modal ${error ? 'active' : ''}`} onClick={closeError}>
          <div className="error-content" onClick={(e) => e.stopPropagation()}>
            <h3>{error?.title}</h3>
            <p>{error?.message}</p>
            <button className="btn btn-primary" onClick={closeError}>OK</button>
          </div>
        </div>
      </div>
    </>
  )
}