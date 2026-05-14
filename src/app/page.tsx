
'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Auth state
  const [user, setUser] = useState<any>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [showAuth, setShowAuth] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // Call state
  const [joinRoomId, setJoinRoomId] = useState('')
  const [error, setError] = useState<{ title: string; message: string } | null>(null)

  // Auth Functions
  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        sessionStorage.setItem('user', JSON.stringify(data.user))
      } else {
        setUser(null)
        sessionStorage.removeItem('user')
      }
    } catch (e) {
      setUser(null)
    } finally {
      setIsAuthLoading(false)
    }
  }

  useEffect(() => {
    const cachedUser = sessionStorage.getItem('user')
    if (cachedUser) {
      try {
        setUser(JSON.parse(cachedUser))
        setIsAuthLoading(false)
        return // Skip network request if user is in sessionStorage
      } catch (e) {}
    }
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
      sessionStorage.setItem('user', JSON.stringify(data.user))
      setUsername('')
      setPassword('')
    } catch (err: any) {
      setError({ title: 'Authentication Error', message: err.message })
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    sessionStorage.removeItem('user')
  }

  // Initial Hash / query param check
  useEffect(() => {
    const joinParam = searchParams.get('join')
    if (joinParam && joinParam.length === 6) {
      setJoinRoomId(joinParam.toUpperCase())
      if (user) {
        router.push(`/room/${joinParam.toUpperCase()}`)
      } else {
        setShowAuth(true)
      }
    }
    const hash = window.location.hash.slice(1)
    if (hash && hash.length === 6) {
      setJoinRoomId(hash.toUpperCase())
    }
  }, [user])

  const closeError = () => setError(null)

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
              <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '.35rem', padding: '.45rem .9rem', borderRadius: '8px', background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', color: '#a5b4fc', textDecoration: 'none', fontSize: '.85rem', fontWeight: 600 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
                Dashboard
              </Link>
              <Link href="/settings" style={{ display: 'flex', alignItems: 'center', gap: '.35rem', padding: '.45rem .9rem', borderRadius: '8px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.7)', textDecoration: 'none', fontSize: '.85rem', fontWeight: 600 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>
                Settings
              </Link>
              <button onClick={handleLogout} className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>Logout</button>
            </div>
          )}
        </header>

        {(!user || (!showAuth && user)) ? (
          !showAuth ? (
            <div className="landing-page-scroll">
            <div className="hero-section">
              <div className="hero-content">
                <h2>Connect Instantly with<br/><span className="highlight">Anyone, Anywhere.</span></h2>
                <p>PeerConnect is a blazing fast, peer-to-peer video calling platform. Create a room instantly, share the code, and start talking securely in high definition without any downloads.</p>
                <div className="hero-actions">
                  {user ? (
                    <button className="btn btn-primary btn-large" onClick={() => router.push('/dashboard')}>Go to Dashboard</button>
                  ) : (
                    <button className="btn btn-primary btn-large" onClick={() => setShowAuth(true)}>Get Started for Free</button>
                  )}
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
        ) : null}

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

export default function Home() {
  return (
    <Suspense fallback={<div className="container"><div style={{ textAlign: 'center', marginTop: '100px', color: 'white' }}>Loading...</div></div>}>
      <HomeContent />
    </Suspense>
  )
}
