import { useEffect, useRef, useState } from 'react'
import { Chime } from './lib/chime'
import { useBlob } from './lib/useBlob'
import { Voice, type VoiceStatus } from './lib/voice'
import './App.css'

// Without a mic, point people to the mouse, or to dragging on a phone.
const touch = window.matchMedia('(pointer: coarse)').matches
const NO_MIC = touch ? 'drag around instead' : 'wiggle the mouse instead'

const HINTS: Record<VoiceStatus, string> = {
  idle: 'say something',
  starting: 'say something',
  listening: 'say something',
  denied: `no mic, that's okay. ${NO_MIC}`,
  unavailable: `couldn't find a mic. ${NO_MIC}`,
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [voice] = useState(() => new Voice())
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const listening = status === 'listening'
  const [chime] = useState(() => new Chime())
  const [muted, setMuted] = useState(chime.muted)

  useBlob(canvasRef, voice, () => chime.play())
  useEffect(() => () => voice.stop(), [voice])

  // Sound can only start after a click, tap or key press, so get the chime
  // ready on the first one.
  useEffect(() => {
    const unlock = () => chime.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [chime])

  const toggleMic = async () => {
    if (listening) {
      voice.stop()
      setStatus(voice.status)
      return
    }
    chime.unlock()
    setStatus('starting')
    const next = await voice.start()
    setStatus(next)
    if (next === 'listening') chime.play()
  }

  const toggleMute = () => {
    chime.setMuted(!muted)
    setMuted(!muted)
  }

  return (
    <div className="app">
      <div className="stage">
        <canvas ref={canvasRef} className="blob-canvas" />
      </div>

      <div className="footer">
        <p className="hint" aria-live="polite">
          {HINTS[status]}
        </p>
        <div className="controls">
          <button
            type="button"
            className="mic-button"
            aria-label={listening ? 'Stop listening' : 'Start listening'}
            aria-pressed={listening}
            onClick={toggleMic}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-2.07A7 7 0 0 0 19 12h-2Z"
              />
            </svg>
          </button>
          <button
            type="button"
            className="mute-button"
            aria-label={muted ? 'Turn sound on' : 'Mute sound'}
            aria-pressed={muted}
            onClick={toggleMute}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3Z" />
              {muted ? (
                <path
                  d="m15.5 9.5 5 5m0-5-5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  fill="currentColor"
                  d="M16.5 12a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Z"
                />
              )}
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
