// The mouse or a finger standing in for the voice when the mic is off, so
// the blob reacts the same way. Moving fast is like talking loudly. Holding
// down and dragging is like a steady voice, which is how it works on a
// phone. Left to right across the screen goes from a low, warm voice to a
// high, bright one.

// Speed, in blob radii per second, that counts as full loudness.
const FULL_SPEED = 8
// While pressed: a quiet hum to start from, and movement counts for more.
const DRAG_BASE = 0.25
const DRAG_BOOST = 1.1

// Same feel as the voice: swells quickly, settles slowly.
const LOUDNESS_ATTACK = 8
const LOUDNESS_RELEASE = 2.5
const BRIGHTNESS_EASE = 4

function ease(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-dt * rate))
}

export class PointerVoice {
  loudness = 0
  brightness = 0

  private travelled = 0
  private lastX: number | null = null
  private lastY = 0
  private pressed = false
  private targetBrightness = 0

  move(x: number, y: number) {
    if (this.lastX !== null) this.travelled += Math.hypot(x - this.lastX, y - this.lastY)
    this.lastX = x
    this.lastY = y
    this.targetBrightness = Math.min(Math.max(x / window.innerWidth, 0), 1)
  }

  down(x: number, y: number) {
    this.pressed = true
    this.move(x, y)
  }

  // A lifted finger or a mouse leaving the window: the next move starts
  // fresh, so jumping to a new spot doesn't count as a fast swipe.
  up(forget: boolean) {
    this.pressed = false
    if (forget) this.lastX = null
  }

  // Call once per frame. radius is the blob's size in pixels, so speed
  // feels the same on a phone and a big screen.
  update(dt: number, radius: number) {
    const speed = dt > 0 ? this.travelled / dt / radius : 0
    this.travelled = 0
    let target = Math.min(speed / FULL_SPEED, 1)
    if (this.pressed) target = Math.min(DRAG_BASE + target * DRAG_BOOST, 1)

    const rate = target > this.loudness ? LOUDNESS_ATTACK : LOUDNESS_RELEASE
    this.loudness = ease(this.loudness, target, rate, dt)
    this.brightness = ease(this.brightness, this.targetBrightness, BRIGHTNESS_EASE, dt)
  }
}
