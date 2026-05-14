'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [joinRoomId, setJoinRoomId] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const cachedUser = sessionStorage.getItem('user')
    if (cachedUser) {
      try { setUser(JSON.parse(cachedUser)); setIsLoading(false); return } catch {}
    }
    fetch('/api/auth/me').then(async res => {
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        sessionStorage.setItem('user', JSON.stringify(data.user))
      } else {
        router.replace('/')
      }
      setIsLoading(false)
    })
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    sessionStorage.removeItem('user')
    router.replace('/')
  }

  const createRoom = async () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let roomId = ''
    for (let i = 0; i < 6; i++) roomId += chars[Math.floor(Math.random() * chars.length)]
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId })
      })
      if (res.ok) router.push(`/room/${roomId}`)
    } catch {}
  }

  const joinRoom = () => {
    const id = joinRoomId.toUpperCase().trim()
    if (id.length === 6) router.push(`/room/${id}`)
  }

  const memberSince = user?.id
    ? new Date(parseInt(user.id.substring(0, 8), 16) * 1000).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '—'

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0f1e', color: 'white' }}>
      Loading...
    </div>
  )

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0f1e; font-family: 'Inter', system-ui, sans-serif; color: white; }
        .dash-shell { min-height: 100vh; background: radial-gradient(ellipse at 20% 20%, rgba(99,102,241,.18) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(16,185,129,.12) 0%, transparent 60%), #0a0f1e; }
        .dash-header { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 2rem; background: rgba(255,255,255,.04); border-bottom: 1px solid rgba(255,255,255,.08); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 10; }
        .logo-row { display: flex; align-items: center; gap: .75rem; text-decoration: none; }
        .logo-icon { width: 36px; height: 36px; background: linear-gradient(135deg,#6366f1,#10b981); border-radius: 10px; display: flex; align-items: center; justify-content: center; }
        .logo-icon svg { width: 20px; height: 20px; fill: white; }
        .logo-text { font-size: 1.2rem; font-weight: 700; color: white; }
        .header-nav { display: flex; align-items: center; gap: .75rem; }
        .nav-link { display: flex; align-items: center; gap: .4rem; padding: .5rem 1rem; border-radius: 8px; color: rgba(255,255,255,.7); text-decoration: none; font-size: .9rem; transition: all .2s; border: 1px solid transparent; }
        .nav-link:hover, .nav-link.active { background: rgba(99,102,241,.15); color: white; border-color: rgba(99,102,241,.3); }
        .nav-link svg { width: 16px; height: 16px; fill: currentColor; }
        .btn-logout { padding: .5rem 1.2rem; border-radius: 8px; background: rgba(239,68,68,.15); border: 1px solid rgba(239,68,68,.3); color: #f87171; font-size: .875rem; cursor: pointer; transition: all .2s; }
        .btn-logout:hover { background: rgba(239,68,68,.25); }

        .dash-body { max-width: 1100px; margin: 0 auto; padding: 2.5rem 2rem; }
        .greeting { font-size: 1.8rem; font-weight: 700; margin-bottom: .4rem; }
        .greeting span { background: linear-gradient(135deg,#6366f1,#10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .sub { color: rgba(255,255,255,.5); font-size: 1rem; margin-bottom: 2.5rem; }

        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }
        .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-bottom: 1.5rem; }
        @media (max-width: 768px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } .dash-body { padding: 1.5rem 1rem; } }

        .card { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 1.5rem; backdrop-filter: blur(8px); transition: transform .2s, border-color .2s; }
        .card:hover { transform: translateY(-2px); border-color: rgba(99,102,241,.3); }
        .card-title { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; color: rgba(255,255,255,.4); margin-bottom: 1rem; }

        /* Profile */
        .profile-card { background: linear-gradient(135deg, rgba(99,102,241,.2), rgba(16,185,129,.1)); border-color: rgba(99,102,241,.3); }
        .avatar-big { width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#10b981); display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; font-size: 1.8rem; font-weight: 700; }
        .username { font-size: 1.5rem; font-weight: 700; margin-bottom: .25rem; }
        .since { color: rgba(255,255,255,.4); font-size: .85rem; }
        .badges { display: flex; gap: .5rem; margin-top: 1rem; flex-wrap: wrap; }
        .badge { padding: .25rem .75rem; border-radius: 20px; font-size: .75rem; font-weight: 600; background: rgba(99,102,241,.2); border: 1px solid rgba(99,102,241,.4); color: #a5b4fc; }
        .badge.green { background: rgba(16,185,129,.2); border-color: rgba(16,185,129,.4); color: #6ee7b7; }

        /* Stat cards */
        .stat-card { text-align: center; }
        .stat-icon { font-size: 1.8rem; margin-bottom: .75rem; }
        .stat-value { font-size: 2rem; font-weight: 700; background: linear-gradient(135deg,#6366f1,#10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .stat-label { color: rgba(255,255,255,.5); font-size: .85rem; margin-top: .25rem; }

        /* Action cards */
        .action-card { cursor: pointer; border-radius: 16px; padding: 1.5rem; border: 1px solid rgba(255,255,255,.1); transition: all .25s; display: flex; flex-direction: column; gap: 1rem; }
        .create-card { background: linear-gradient(135deg, rgba(99,102,241,.25), rgba(99,102,241,.08)); border-color: rgba(99,102,241,.3); }
        .create-card:hover { background: linear-gradient(135deg, rgba(99,102,241,.4), rgba(99,102,241,.15)); border-color: #6366f1; transform: translateY(-2px); }
        .join-card { background: rgba(255,255,255,.05); }
        .join-card:hover { border-color: rgba(16,185,129,.4); transform: translateY(-2px); }
        .action-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
        .action-icon.purple { background: rgba(99,102,241,.3); }
        .action-icon.green { background: rgba(16,185,129,.3); }
        .action-icon svg { width: 24px; height: 24px; fill: white; }
        .action-title { font-size: 1.1rem; font-weight: 700; }
        .action-desc { color: rgba(255,255,255,.5); font-size: .875rem; line-height: 1.5; }
        .join-input-row { display: flex; gap: .5rem; margin-top: .5rem; }
        .join-input { flex: 1; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: .6rem 1rem; color: white; font-size: .95rem; letter-spacing: .1em; font-weight: 600; text-transform: uppercase; outline: none; }
        .join-input:focus { border-color: #10b981; }
        .join-input::placeholder { text-transform: none; letter-spacing: 0; font-weight: 400; color: rgba(255,255,255,.3); }
        .btn-join { padding: .6rem 1.25rem; background: linear-gradient(135deg,#10b981,#059669); border: none; border-radius: 8px; color: white; font-weight: 600; cursor: pointer; font-size: .9rem; transition: opacity .2s; }
        .btn-join:hover { opacity: .85; }

        /* Quick settings strip */
        .settings-strip { display: flex; align-items: center; justify-content: space-between; }
        .setting-item { display: flex; align-items: center; gap: .75rem; }
        .setting-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
        .setting-dot.warn { background: #f59e0b; }
        .setting-name { color: rgba(255,255,255,.6); font-size: .875rem; }
        .setting-value { font-size: .875rem; font-weight: 600; color: white; }
        .btn-settings-link { padding: .5rem 1rem; background: rgba(99,102,241,.15); border: 1px solid rgba(99,102,241,.3); border-radius: 8px; color: #a5b4fc; font-size: .85rem; text-decoration: none; transition: all .2s; }
        .btn-settings-link:hover { background: rgba(99,102,241,.25); }
      `}</style>

      <div className="dash-shell">
        {/* Header */}
        <header className="dash-header">
          <Link href="/dashboard" className="logo-row">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
            </div>
            <span className="logo-text">PeerConnect</span>
          </Link>

          <nav className="header-nav">
            <Link href="/dashboard" className="nav-link active">
              <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
              Dashboard
            </Link>
            <Link href="/settings" className="nav-link">
              <svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>
              Settings
            </Link>
            <button className="btn-logout" onClick={handleLogout}>Logout</button>
          </nav>
        </header>

        <div className="dash-body">
          <div className="greeting">
            Welcome back, <span>{user?.username}</span>
          </div>
          <p className="sub">Ready to connect? Start a room or join one below.</p>

          {/* Top row — profile + stats */}
          <div className="grid-2">
            {/* Profile card */}
            <div className="card profile-card">
              <div className="card-title">Your Profile</div>
              <div className="avatar-big">{user?.username?.[0]?.toUpperCase()}</div>
              <div className="username">{user?.username}</div>
              <div className="since">Member since {memberSince}</div>
              <div className="badges">
                <span className="badge">Verified</span>
                <span className="badge green">P2P Ready</span>
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="grid-3" style={{ marginBottom: 0 }}>
                <div className="card stat-card">
                  <div className="stat-icon">🎥</div>
                  <div className="stat-value">P2P</div>
                  <div className="stat-label">Connection Type</div>
                </div>
                <div className="card stat-card">
                  <div className="stat-icon">🔒</div>
                  <div className="stat-value">E2E</div>
                  <div className="stat-label">Encrypted</div>
                </div>
                <div className="card stat-card">
                  <div className="stat-icon">⚡</div>
                  <div className="stat-value">HD</div>
                  <div className="stat-label">Video Quality</div>
                </div>
              </div>

              {/* Settings preview */}
              <div className="card" style={{ flex: 1 }}>
                <div className="card-title">Quick Settings</div>
                <SettingsPreview />
                <div style={{ marginTop: '1rem' }}>
                  <Link href="/settings" className="btn-settings-link">Manage All Settings →</Link>
                </div>
              </div>
            </div>
          </div>

          {/* Action cards */}
          <div className="grid-2">
            {/* Create */}
            <div className="action-card create-card" onClick={createRoom}>
              <div className="action-icon purple">
                <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              </div>
              <div>
                <div className="action-title">Create a Room</div>
                <div className="action-desc">Instantly generate a secure room and get a shareable invite link. You'll be set as admin.</div>
              </div>
            </div>

            {/* Join */}
            <div className="action-card join-card">
              <div className="action-icon green">
                <svg viewBox="0 0 24 24"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              </div>
              <div>
                <div className="action-title">Join a Room</div>
                <div className="action-desc">Enter a 6-character room code to join an existing call.</div>
              </div>
              <div className="join-input-row">
                <input
                  className="join-input"
                  type="text"
                  placeholder="Enter room code"
                  maxLength={6}
                  value={joinRoomId}
                  onChange={e => setJoinRoomId(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && joinRoom()}
                />
                <button className="btn-join" onClick={joinRoom}>Join →</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function SettingsPreview() {
  const [s, setS] = useState<any>(null)
  useEffect(() => {
    const { loadSettings } = require('@/lib/settings')
    setS(loadSettings())
  }, [])
  if (!s) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
      {[
        { label: 'Video Quality', value: s.videoQuality, warn: s.videoQuality === '360p' },
        { label: 'Frame Rate', value: `${s.frameRate} fps` },
        { label: 'Noise Suppression', value: s.noiseSuppression ? 'On' : 'Off', warn: !s.noiseSuppression },
        { label: 'Max Video Bitrate', value: `${s.maxVideoBitrate} kbps` },
      ].map(({ label, value, warn }) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,.5)', fontSize: '.85rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: warn ? '#f59e0b' : '#10b981', display: 'inline-block' }} />
            {label}
          </span>
          <span style={{ fontSize: '.85rem', fontWeight: 600, color: warn ? '#fbbf24' : 'white' }}>{value}</span>
        </div>
      ))}
    </div>
  )
}
