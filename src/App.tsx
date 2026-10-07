import { useRef } from 'react'
import { useBlob } from './lib/useBlob'
import './App.css'

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useBlob(canvasRef)

  return (
    <div className="app">
      <div className="stage">
        <canvas ref={canvasRef} className="blob-canvas" />
      </div>

      <div className="footer">
        <p className="hint">say something</p>
        <div className="controls">
          <button type="button" className="mic-button" aria-label="Start listening">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-2.07A7 7 0 0 0 19 12h-2Z"
              />
            </svg>
          </button>
          <button type="button" className="mute-button" aria-label="Mute sound">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M3 10v4h4l5 5V5L7 10H3Zm13.5 2a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Z"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
