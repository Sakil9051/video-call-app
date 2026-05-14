'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, AppSettings } from '@/lib/settings'

type DeviceInfo = { deviceId: string; label: string }

export default function SettingsPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [cameras, setCameras] = useState<DeviceInfo[]>([])
  const [mics, setMics] = useState<DeviceInfo[]>([])
  const previewRef = useRef<HTMLVideoElement>(null)
  const previewStreamRef = useRef<MediaStream | null>(null)

  // Auth check
  useEffect(() => {
    const cached = sessionStorage.getItem('user')
    if (cached) { try { setUser(JSON.parse(cached)) } catch {} }
    else {
      fetch('/api/auth/me').then(async res => {
        if (res.ok) { const d = await res.json(); setUser(d.user) }
        else router.replace('/')
      })
    }
    setSettings(loadSettings())
  }, [])

  // Enumerate devices (requires permission first)
  const loadDevices = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameras(devices.filter(d => d.kind === 'videoinput').map(d => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0,4)}` })))
      setMics(devices.filter(d => d.kind === 'audioinput').map(d => ({ deviceId: d.deviceId, label: d.label || `Mic ${d.deviceId.slice(0,4)}` })))
    } catch {}
  }

  useEffect(() => { loadDevices() }, [])

  // Live preview
  const startPreview = async () => {
    stopPreview()
    try {
      const { buildVideoConstraints, buildAudioConstraints } = await import('@/lib/settings')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(settings),
        audio: buildAudioConstraints(settings),
      })
      previewStreamRef.current = stream
      if (previewRef.current) previewRef.current.srcObject = stream
    } catch {}
  }

  const stopPreview = () => {
    previewStreamRef.current?.getTracks().forEach(t => t.stop())
    previewStreamRef.current = null
    if (previewRef.current) previewRef.current.srcObject = null
  }

  useEffect(() => () => stopPreview(), [])

  const set = (patch: Partial<AppSettings>) => setSettings(prev => ({ ...prev, ...patch }))

  const handleSave = () => {
    saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS)
    saveSettings(DEFAULT_SETTINGS)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0f1e; font-family: 'Inter', system-ui, sans-serif; color: white; }
        .shell { min-height: 100vh; background: radial-gradient(ellipse at 20% 20%, rgba(99,102,241,.18) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(16,185,129,.12) 0%, transparent 60%), #0a0f1e; }
        .hdr { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 2rem; background: rgba(255,255,255,.04); border-bottom: 1px solid rgba(255,255,255,.08); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 10; }
        .logo-row { display: flex; align-items: center; gap: .75rem; text-decoration: none; }
        .logo-icon { width: 36px; height: 36px; background: linear-gradient(135deg,#6366f1,#10b981); border-radius: 10px; display: flex; align-items: center; justify-content: center; }
        .logo-icon svg { width: 20px; height: 20px; fill: white; }
        .logo-text { font-size: 1.2rem; font-weight: 700; color: white; }
        .nav-links { display: flex; align-items: center; gap: .75rem; }
        .nav-link { display: flex; align-items: center; gap: .4rem; padding: .5rem 1rem; border-radius: 8px; color: rgba(255,255,255,.7); text-decoration: none; font-size: .9rem; transition: all .2s; border: 1px solid transparent; }
        .nav-link:hover, .nav-link.active { background: rgba(99,102,241,.15); color: white; border-color: rgba(99,102,241,.3); }
        .nav-link svg { width: 16px; height: 16px; fill: currentColor; }

        .body { max-width: 900px; margin: 0 auto; padding: 2.5rem 2rem; }
        .page-title { font-size: 1.8rem; font-weight: 700; margin-bottom: .4rem; }
        .page-sub { color: rgba(255,255,255,.5); font-size: .95rem; margin-bottom: 2.5rem; }
        .page-sub span { color: #a5b4fc; }

        .settings-layout { display: grid; grid-template-columns: 1fr 320px; gap: 1.5rem; }
        @media (max-width: 768px) { .settings-layout { grid-template-columns: 1fr; } .body { padding: 1.5rem 1rem; } }

        .section { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 1.5rem; backdrop-filter: blur(8px); margin-bottom: 1.5rem; }
        .section-title { display: flex; align-items: center; gap: .6rem; font-size: 1rem; font-weight: 700; margin-bottom: 1.5rem; padding-bottom: .75rem; border-bottom: 1px solid rgba(255,255,255,.08); }
        .section-title-icon { font-size: 1.2rem; }
        
        .field { margin-bottom: 1.25rem; }
        .field:last-child { margin-bottom: 0; }
        .field-label { font-size: .85rem; color: rgba(255,255,255,.6); margin-bottom: .5rem; font-weight: 500; display: flex; justify-content: space-between; }
        .field-label span { color: white; font-weight: 600; }

        /* Segment (pill group) */
        .segment { display: flex; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.1); border-radius: 10px; overflow: hidden; }
        .seg-btn { flex: 1; padding: .5rem; font-size: .85rem; border: none; background: transparent; color: rgba(255,255,255,.5); cursor: pointer; transition: all .2s; font-weight: 500; }
        .seg-btn.active { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: white; font-weight: 700; }

        /* Toggle */
        .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: .75rem 0; border-bottom: 1px solid rgba(255,255,255,.05); }
        .toggle-row:last-child { border-bottom: none; }
        .toggle-info { }
        .toggle-name { font-size: .9rem; font-weight: 600; }
        .toggle-desc { font-size: .78rem; color: rgba(255,255,255,.4); margin-top: .15rem; }
        .toggle { position: relative; width: 44px; height: 24px; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .toggle-track { position: absolute; inset: 0; border-radius: 24px; background: rgba(255,255,255,.15); cursor: pointer; transition: background .2s; }
        .toggle input:checked + .toggle-track { background: linear-gradient(135deg,#6366f1,#10b981); }
        .toggle-track::before { content:''; position: absolute; width: 18px; height: 18px; border-radius: 50%; background: white; top: 3px; left: 3px; transition: transform .2s; }
        .toggle input:checked + .toggle-track::before { transform: translateX(20px); }

        /* Select */
        .sel { width: 100%; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: .6rem 1rem; color: white; font-size: .9rem; outline: none; cursor: pointer; }
        .sel:focus { border-color: #6366f1; }
        .sel option { background: #1a1f35; }

        /* Slider */
        .slider-row { display: flex; align-items: center; gap: .75rem; }
        .slider { flex: 1; -webkit-appearance: none; height: 4px; border-radius: 4px; background: rgba(255,255,255,.1); outline: none; }
        .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#10b981); cursor: pointer; }
        .slider-val { width: 60px; text-align: right; font-size: .9rem; font-weight: 600; color: #a5b4fc; }

        /* Preview column */
        .preview-card { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; position: sticky; top: 90px; }
        .preview-header { padding: 1rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,.08); font-weight: 700; font-size: .95rem; }
        .preview-video-wrap { aspect-ratio: 16/9; background: rgba(0,0,0,.4); position: relative; }
        .preview-video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .preview-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5rem; color: rgba(255,255,255,.3); font-size: .85rem; }
        .preview-placeholder svg { width: 40px; height: 40px; fill: rgba(255,255,255,.2); }
        .preview-body { padding: 1.25rem; display: flex; flex-direction: column; gap: .75rem; }
        .btn-preview { width: 100%; padding: .7rem; border-radius: 10px; border: 1px solid rgba(99,102,241,.4); background: rgba(99,102,241,.2); color: white; font-weight: 600; cursor: pointer; font-size: .9rem; transition: all .2s; }
        .btn-preview:hover { background: rgba(99,102,241,.35); }
        .btn-stop { background: rgba(239,68,68,.2); border-color: rgba(239,68,68,.4); }
        .btn-stop:hover { background: rgba(239,68,68,.35); }

        /* Info chips */
        .info-chip { display: flex; justify-content: space-between; font-size: .8rem; padding: .35rem 0; border-bottom: 1px solid rgba(255,255,255,.05); }
        .info-chip:last-child { border-bottom: none; }
        .info-key { color: rgba(255,255,255,.4); }
        .info-val { color: white; font-weight: 600; }

        /* Save bar */
        .save-bar { display: flex; gap: .75rem; margin-top: 1.5rem; }
        .btn-save { flex: 1; padding: .85rem; border-radius: 12px; background: linear-gradient(135deg,#6366f1,#10b981); border: none; color: white; font-size: 1rem; font-weight: 700; cursor: pointer; transition: opacity .2s; }
        .btn-save:hover { opacity: .9; }
        .btn-save.done { background: linear-gradient(135deg,#10b981,#059669); }
        .btn-reset { padding: .85rem 1.5rem; border-radius: 12px; background: transparent; border: 1px solid rgba(255,255,255,.15); color: rgba(255,255,255,.6); font-size: .9rem; cursor: pointer; transition: all .2s; }
        .btn-reset:hover { border-color: rgba(239,68,68,.4); color: #f87171; }
      `}</style>

      <div className="shell">
        <header className="hdr">
          <Link href="/dashboard" className="logo-row">
            <div className="logo-icon"><svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg></div>
            <span className="logo-text">PeerConnect</span>
          </Link>
          <nav className="nav-links">
            <Link href="/dashboard" className="nav-link">
              <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
              Dashboard
            </Link>
            <Link href="/settings" className="nav-link active">
              <svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>
              Settings
            </Link>
          </nav>
        </header>

        <div className="body">
          <div className="page-title">⚙️ Settings</div>
          <p className="page-sub">Customise your call quality. Saved to <span>this device</span> and applied to every call.</p>

          <div className="settings-layout">
            {/* Left: settings panels */}
            <div>
              {/* Video Quality */}
              <div className="section">
                <div className="section-title"><span className="section-title-icon">🎥</span> Video Quality</div>

                <div className="field">
                  <div className="field-label">Resolution <span>{settings.videoQuality}</span></div>
                  <div className="segment">
                    {(['360p','480p','720p','1080p'] as const).map(q => (
                      <button key={q} className={`seg-btn ${settings.videoQuality === q ? 'active' : ''}`} onClick={() => set({ videoQuality: q })}>{q}</button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <div className="field-label">Frame Rate <span>{settings.frameRate} fps</span></div>
                  <div className="segment">
                    {([15, 24, 30] as const).map(r => (
                      <button key={r} className={`seg-btn ${settings.frameRate === r ? 'active' : ''}`} onClick={() => set({ frameRate: r })}>{r} fps</button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <div className="field-label">Camera</div>
                  <select className="sel" value={settings.videoDeviceId} onChange={e => set({ videoDeviceId: e.target.value })}>
                    <option value="">Default camera</option>
                    {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
                  </select>
                </div>

                <div className="field">
                  <div className="field-label">Camera Facing (Mobile)</div>
                  <div className="segment">
                    <button className={`seg-btn ${settings.facingMode === 'user' ? 'active' : ''}`} onClick={() => set({ facingMode: 'user' })}>Front</button>
                    <button className={`seg-btn ${settings.facingMode === 'environment' ? 'active' : ''}`} onClick={() => set({ facingMode: 'environment' })}>Back</button>
                  </div>
                </div>
              </div>

              {/* Audio */}
              <div className="section">
                <div className="section-title"><span className="section-title-icon">🎙️</span> Audio</div>

                <div className="field">
                  <div className="field-label">Microphone</div>
                  <select className="sel" value={settings.audioDeviceId} onChange={e => set({ audioDeviceId: e.target.value })}>
                    <option value="">Default microphone</option>
                    {mics.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}
                  </select>
                </div>

                <div className="field">
                  <div className="field-label">Sample Rate <span>{settings.sampleRate / 1000} kHz</span></div>
                  <div className="segment">
                    <button className={`seg-btn ${settings.sampleRate === 44100 ? 'active' : ''}`} onClick={() => set({ sampleRate: 44100 })}>44.1 kHz</button>
                    <button className={`seg-btn ${settings.sampleRate === 48000 ? 'active' : ''}`} onClick={() => set({ sampleRate: 48000 })}>48 kHz (rec.)</button>
                  </div>
                </div>

                {([
                  { key: 'echoCancellation' as const, name: 'Echo Cancellation', desc: 'Removes your voice from your own mic feed' },
                  { key: 'noiseSuppression' as const, name: 'Noise Suppression', desc: 'Filters background noise like fans and keyboards' },
                  { key: 'autoGainControl' as const, name: 'Auto Gain Control', desc: 'Automatically adjusts your mic volume level' },
                ]).map(({ key, name, desc }) => (
                  <div className="toggle-row" key={key}>
                    <div className="toggle-info">
                      <div className="toggle-name">{name}</div>
                      <div className="toggle-desc">{desc}</div>
                    </div>
                    <label className="toggle">
                      <input type="checkbox" checked={settings[key]} onChange={e => set({ [key]: e.target.checked })} />
                      <span className="toggle-track" />
                    </label>
                  </div>
                ))}
              </div>

              {/* Network / Bandwidth */}
              <div className="section">
                <div className="section-title"><span className="section-title-icon">📡</span> Network & Bandwidth</div>

                <div className="field">
                  <div className="field-label">Max Video Bitrate <span>{settings.maxVideoBitrate} kbps</span></div>
                  <div className="segment">
                    {([300, 800, 2000] as const).map(b => (
                      <button key={b} className={`seg-btn ${settings.maxVideoBitrate === b ? 'active' : ''}`} onClick={() => set({ maxVideoBitrate: b })}>
                        {b === 300 ? 'Low' : b === 800 ? 'Standard' : 'High'}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: '.5rem', fontSize: '.78rem', color: 'rgba(255,255,255,.4)' }}>
                    Low: saves data on mobile · Standard: balanced · High: best quality on fast Wi-Fi
                  </div>
                </div>

                <div className="field">
                  <div className="field-label">Max Audio Bitrate <span>{settings.maxAudioBitrate} kbps</span></div>
                  <div className="segment">
                    {([32, 64, 128] as const).map(b => (
                      <button key={b} className={`seg-btn ${settings.maxAudioBitrate === b ? 'active' : ''}`} onClick={() => set({ maxAudioBitrate: b })}>
                        {b === 32 ? 'Low' : b === 64 ? 'Standard' : 'HD'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Save / Reset */}
              <div className="save-bar">
                <button className={`btn-save ${saved ? 'done' : ''}`} onClick={handleSave}>
                  {saved ? '✓ Saved!' : 'Save Settings'}
                </button>
                <button className="btn-reset" onClick={handleReset}>Reset Defaults</button>
              </div>
            </div>

            {/* Right: preview */}
            <div>
              <div className="preview-card">
                <div className="preview-header">📷 Camera Preview</div>
                <div className="preview-video-wrap">
                  <video ref={previewRef} autoPlay playsInline muted className="preview-video" />
                  <div className="preview-placeholder" id="preview-ph" style={{ display: previewStreamRef.current ? 'none' : 'flex' }}>
                    <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                    Click below to preview
                  </div>
                </div>
                <div className="preview-body">
                  <button className="btn-preview" onClick={startPreview}>▶ Start Preview</button>
                  <button className="btn-preview btn-stop" onClick={stopPreview}>■ Stop Preview</button>

                  <div style={{ marginTop: '.5rem' }}>
                    <div style={{ fontSize: '.8rem', color: 'rgba(255,255,255,.4)', marginBottom: '.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Current Config</div>
                    {[
                      ['Resolution', settings.videoQuality],
                      ['Frame Rate', `${settings.frameRate} fps`],
                      ['Video Bitrate', `${settings.maxVideoBitrate} kbps`],
                      ['Audio Bitrate', `${settings.maxAudioBitrate} kbps`],
                      ['Sample Rate', `${settings.sampleRate / 1000} kHz`],
                      ['Echo Cancel', settings.echoCancellation ? 'On' : 'Off'],
                      ['Noise Suppress', settings.noiseSuppression ? 'On' : 'Off'],
                    ].map(([k, v]) => (
                      <div className="info-chip" key={k}>
                        <span className="info-key">{k}</span>
                        <span className="info-val">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
