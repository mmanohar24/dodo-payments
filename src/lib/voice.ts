// Listens to the mic and turns it into two calm numbers, both 0 to 1:
// loudness (from RMS) and brightness (from the spectral centroid).

export type VoiceStatus = 'idle' | 'starting' | 'listening' | 'denied' | 'unavailable'

// Loudness: RMS in decibels, mapped so a quiet room is 0 and a raised
// voice is 1.
const QUIET_DB = -55
const LOUD_DB = -15
// Brightness: spectral centroid in Hz, mapped on a log scale so a low hum
// is 0 and a high, airy voice is 1. Spoken vowels mostly land between
// about 700 Hz and 1.2 kHz, so the range is kept tight around that; a
// wider one left normal talking stuck near the bottom.
const DARK_HZ = 600
const BRIGHT_HZ = 1800
const MIN_HZ = 80
const MAX_HZ = 8000
// Below this loudness it's just room noise, so brightness holds still.
const VOICE_GATE = 0.08

// Smoothing speeds, per second. Loudness rises quickly and falls slowly,
// so the blob swells with your voice and settles gently.
const LOUDNESS_ATTACK = 12
const LOUDNESS_RELEASE = 3
const BRIGHTNESS_EASE = 4

function clamp01(x: number) {
  return Math.min(Math.max(x, 0), 1)
}

function ease(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-dt * rate))
}

export class Voice {
  loudness = 0
  brightness = 0
  status: VoiceStatus = 'idle'

  private stream: MediaStream | null = null
  private audio: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private timeData: Float32Array = new Float32Array(0)
  private freqData: Float32Array = new Float32Array(0)

  // Must be called from a tap or click, so the browser only asks for mic
  // permission when the user asks for it.
  async start(): Promise<VoiceStatus> {
    if (this.status === 'listening' || this.status === 'starting') return this.status
    if (!navigator.mediaDevices?.getUserMedia) {
      this.status = 'unavailable'
      return this.status
    }
    this.status = 'starting'
    // Created before the await so it counts as part of the tap.
    const audio = new AudioContext()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Browser clean-up would flatten loudness and dull the tone.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      await audio.resume()
      const analyser = audio.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.5
      audio.createMediaStreamSource(stream).connect(analyser)

      this.stream = stream
      this.audio = audio
      this.analyser = analyser
      this.timeData = new Float32Array(analyser.fftSize)
      this.freqData = new Float32Array(analyser.frequencyBinCount)
      this.status = 'listening'
    } catch (err) {
      audio.close()
      const name = err instanceof DOMException ? err.name : ''
      this.status = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable'
    }
    return this.status
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.audio?.close()
    this.stream = null
    this.audio = null
    this.analyser = null
    this.status = 'idle'
  }

  // Call once per frame. Reads the mic and eases both values toward it.
  update(dt: number) {
    let targetLoudness = 0
    let targetBrightness = this.brightness

    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.timeData)
      let sum = 0
      for (const sample of this.timeData) sum += sample * sample
      const rms = Math.sqrt(sum / this.timeData.length)
      const db = 20 * Math.log10(rms + 1e-9)
      targetLoudness = clamp01((db - QUIET_DB) / (LOUD_DB - QUIET_DB))

      if (targetLoudness > VOICE_GATE) {
        targetBrightness = this.readBrightness()
      }
    }

    const rate = targetLoudness > this.loudness ? LOUDNESS_ATTACK : LOUDNESS_RELEASE
    this.loudness = ease(this.loudness, targetLoudness, rate, dt)
    this.brightness = ease(this.brightness, targetBrightness, BRIGHTNESS_EASE, dt)
  }

  private readBrightness() {
    const analyser = this.analyser!
    analyser.getFloatFrequencyData(this.freqData)
    const binHz = analyser.context.sampleRate / analyser.fftSize
    const first = Math.max(1, Math.floor(MIN_HZ / binHz))
    const last = Math.min(this.freqData.length - 1, Math.ceil(MAX_HZ / binHz))

    let weighted = 0
    let total = 0
    for (let i = first; i <= last; i++) {
      const magnitude = 10 ** (this.freqData[i] / 20)
      weighted += i * binHz * magnitude
      total += magnitude
    }
    if (total === 0) return this.brightness
    const centroid = weighted / total
    return clamp01(Math.log(centroid / DARK_HZ) / Math.log(BRIGHT_HZ / DARK_HZ))
  }
}
