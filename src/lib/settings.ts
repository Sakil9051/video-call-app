// ---- Types ----

export interface AppSettings {
  // Video
  videoQuality: '360p' | '480p' | '720p' | '1080p'
  frameRate: 15 | 24 | 30
  facingMode: 'user' | 'environment'

  // Audio
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  sampleRate: 48000 | 44100

  // Network / bandwidth
  maxVideoBitrate: 300 | 800 | 2000   // kbps
  maxAudioBitrate: 32  | 64  | 128    // kbps

  // Devices (deviceId strings, empty = default)
  videoDeviceId: string
  audioDeviceId: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  videoQuality:     '720p',
  frameRate:        24,
  facingMode:       'user',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl:  true,
  sampleRate:       48000,
  maxVideoBitrate:  800,
  maxAudioBitrate:  64,
  videoDeviceId:    '',
  audioDeviceId:    '',
}

const STORAGE_KEY = 'peerconnect_settings'

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Partial<AppSettings>): AppSettings {
  const merged = { ...loadSettings(), ...s }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  return merged
}

// ---- Helpers used in the room page ----

export function buildVideoConstraints(s: AppSettings): MediaTrackConstraints {
  const dims: Record<AppSettings['videoQuality'], { width: number; height: number }> = {
    '360p':  { width: 640,  height: 360  },
    '480p':  { width: 854,  height: 480  },
    '720p':  { width: 1280, height: 720  },
    '1080p': { width: 1920, height: 1080 },
  }
  const { width, height } = dims[s.videoQuality]
  return {
    width:     { ideal: width,  max: width  },
    height:    { ideal: height, max: height },
    frameRate: { ideal: s.frameRate, max: s.frameRate },
    facingMode: s.facingMode,
    ...(s.videoDeviceId ? { deviceId: { exact: s.videoDeviceId } } : {}),
  }
}

export function buildAudioConstraints(s: AppSettings): MediaTrackConstraints {
  return {
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl:  s.autoGainControl,
    sampleRate:       s.sampleRate,
    channelCount:     1,
    ...(s.audioDeviceId ? { deviceId: { exact: s.audioDeviceId } } : {}),
  }
}
