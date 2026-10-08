// A soft chime: three quiet sine notes, rising, made with the Web Audio
// API. No audio files.

const NOTES = [659.25, 830.61, 987.77] // E5, G#5, B5
const NOTE_GAP = 0.09 // seconds between notes
const NOTE_PEAK = 0.05 // loudness of each note, out of 1
const NOTE_ATTACK = 0.015 // seconds to fade in, so it doesn't click
const NOTE_DECAY = 0.9 // seconds to fade out

// Never chime more often than this, so waking up a lot doesn't nag.
const MIN_GAP_MS = 3000
const STORAGE_KEY = 'hush-muted'

// Schedules the chime on any audio context, starting at time `at`.
// Shared with tests, which render it offline to check how it sounds.
export function scheduleChime(audio: BaseAudioContext, out: AudioNode, at: number) {
  NOTES.forEach((hz, i) => {
    const start = at + i * NOTE_GAP
    const osc = audio.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = hz
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(NOTE_PEAK, start + NOTE_ATTACK)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_DECAY)
    osc.connect(gain).connect(out)
    osc.start(start)
    osc.stop(start + NOTE_DECAY + 0.05)
  })
}

function readMuted() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export class Chime {
  muted = readMuted()

  private audio: AudioContext | null = null
  private out: GainNode | null = null
  private lastPlayed = -Infinity
  // Set while sound is starting up after a click. Some browsers (Safari)
  // take a moment, and a chime asked for during that moment waits for it.
  private resuming: Promise<void> | null = null

  // Browsers only allow sound after the user clicks, taps or types. Call
  // this from one of those so later chimes (like waking up when the mouse
  // moves) can play.
  unlock() {
    if (!this.audio) {
      this.audio = new AudioContext()
      this.out = this.audio.createGain()
      this.out.gain.value = this.muted ? 0 : 1
      this.out.connect(this.audio.destination)
    }
    if (this.audio.state === 'suspended' && !this.resuming) {
      this.resuming = this.audio.resume().finally(() => {
        this.resuming = null
      })
    }
  }

  play() {
    const audio = this.audio
    const out = this.out
    if (this.muted || !audio || !out) return
    if (audio.state !== 'running' && !this.resuming) return
    const now = performance.now()
    if (now - this.lastPlayed < MIN_GAP_MS) return
    this.lastPlayed = now
    const ring = () => {
      if (!this.muted) scheduleChime(audio, out, audio.currentTime + 0.01)
    }
    if (audio.state === 'running') ring()
    else this.resuming?.then(ring)
  }

  setMuted(muted: boolean) {
    this.muted = muted
    try {
      sessionStorage.setItem(STORAGE_KEY, muted ? '1' : '0')
    } catch {
      // Storage can be blocked; muting still works for this page.
    }
    // Also silences a chime that's already ringing.
    if (this.audio && this.out) {
      this.out.gain.setTargetAtTime(muted ? 0 : 1, this.audio.currentTime, 0.02)
    }
  }
}
