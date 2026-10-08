import { useEffect, useRef, type RefObject } from 'react'
import { edgeRadius, generateDots, type Dot } from './blobDots'
import type { Voice } from './voice'

const MAX_DPR = 2
// The canvas is this much bigger than the blob's resting box (see
// .blob-canvas in App.css), leaving room to grow and squish.
const CANVAS_OVERSCAN = 1.5
// Blob radius as a fraction of the canvas size.
const BLOB_RADIUS = 0.38 / CANVAS_OVERSCAN
const DOT_COUNT = 1500
const DOT_RADIUS = 1.6

const PEACH = { r: 0xff, g: 0xb9, b: 0x96 }
const PINK = { r: 0xff, g: 0x8f, b: 0xa3 }
const LAVENDER = { r: 0xb8, g: 0xa1, b: 0xff }
const EYE_COLOR = '#0b1026'
const EYE_HIGHLIGHT = '#fff7f2'

// Eye geometry, as fractions of the blob's base radius / the eye's radius.
const EYE_RADIUS = 0.09
const EYE_SPACING = 0.34
const EYE_RAISE = 0.12
// Solid patch behind each eye so it reads against the dot texture, whose
// gaps are the same colour as the eye.
const EYE_PATCH_RADIUS = 2
const EYE_LID_WIDTH = 0.5
const EYE_HIGHLIGHT_RADIUS = 0.3

// A blink is a fast close, a short hold, then a slower open.
const BLINK_CLOSE = 90
const BLINK_HOLD = 70
const BLINK_OPEN = 150
const BLINK_DURATION = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN
const BLINK_MIN_GAP = 2500
const BLINK_MAX_GAP = 6000
const DOUBLE_BLINK_CHANCE = 0.2
const DOUBLE_BLINK_GAP = 120

// Pupils drift toward the pointer by at most this fraction of the eye's
// radius, so they stay inside the solid patch.
const LOOK_MAX_X = 0.35
const LOOK_MAX_Y = 0.25
// Pointer distance (in blob radii) at which the pupils reach their limit.
const LOOK_FULL_REACH = 1.5
// How quickly the pupils catch up with the pointer, per second.
const LOOK_EASE = 6

// Poke: a damped spring on how squashed the blob is. Low damping lets it
// wobble a few times like jelly before it settles.
const POKE_STIFFNESS = 180
const POKE_DAMPING = 7
const POKE_IMPULSE = 2.4
const POKE_MAX_SQUASH = 0.3
// With reduced motion: a softer push that settles without wobbling.
const POKE_DAMPING_REDUCED = 2 * Math.sqrt(POKE_STIFFNESS)
const POKE_IMPULSE_REDUCED = 1.2
// Small steps keep the spring stable even on a slow frame.
const SPRING_STEP = 1 / 120

// Voice: at full loudness the blob grows by VOICE_GROW, and each dot also
// drifts outward by up to VOICE_SPREAD so the dots loosen apart.
const VOICE_GROW = 0.18
const VOICE_SPREAD = 0.35
// Colour: a bright, high voice tints the blob up to this far toward
// lavender. The tint only shows while you're making sound, so the blob
// drifts back to peach and pink when it's quiet.
const VOICE_LAVENDER = 0.85
const VOICE_PRESENT = 0.3

// Sleep: after SLEEP_AFTER ms with no voice, click or mouse move, the blob
// yawns (eyes squint, body stretches up a little), then slowly shrinks,
// dims and closes its eyes. Any activity wakes it.
const SLEEP_AFTER = 5000
const YAWN_DURATION = 2200
const YAWN_SQUINT = 0.7
const YAWN_STRETCH = 0.07
const ASLEEP_SHRINK = 0.12
const ASLEEP_DIM = 0.45
// How fast it drifts off and wakes up, per second.
const FALL_ASLEEP_RATE = 0.8
const WAKE_RATE = 4
const SQUINT_EASE = 6
// Loudness that counts as someone talking, above room noise.
const WAKE_LOUDNESS = 0.2
// Breathing: speed (radians per second) and depth, awake and asleep.
const BREATHE_SPEED = 0.6
const BREATHE_SPEED_ASLEEP = 0.35
const BREATHE_DEPTH = 0.035
const BREATHE_DEPTH_ASLEEP = 0.05

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// t: 0 at the centre (peach) to 1 at the edge (pink).
// lavender: 0 to 1, how far a high voice has tinted it toward lavender.
function blobColor(t: number, alpha = 1, lavender = 0) {
  const r = Math.round(lerp(lerp(PEACH.r, PINK.r, t), LAVENDER.r, lavender))
  const g = Math.round(lerp(lerp(PEACH.g, PINK.g, t), LAVENDER.g, lavender))
  const b = Math.round(lerp(lerp(PEACH.b, PINK.b, t), LAVENDER.b, lavender))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

// Eye openness (1 = open, 0 = shut) at `elapsed` ms into a blink.
function blinkOpenness(elapsed: number) {
  if (elapsed < BLINK_CLOSE) {
    const p = elapsed / BLINK_CLOSE
    return 1 - p * p
  }
  if (elapsed < BLINK_CLOSE + BLINK_HOLD) return 0
  if (elapsed < BLINK_DURATION) {
    const p = (elapsed - BLINK_CLOSE - BLINK_HOLD) / BLINK_OPEN
    return 1 - (1 - p) * (1 - p)
  }
  return 1
}

// Yawn strength over the yawn (p from 0 to 1): open up, hold, let go.
function yawnCurve(p: number) {
  return smoothstep(0, 0.35, p) * (1 - smoothstep(0.65, 1, p))
}

function nextBlinkDelay() {
  return BLINK_MIN_GAP + Math.random() * (BLINK_MAX_GAP - BLINK_MIN_GAP)
}

// onWake runs when the blob wakes up from being fully asleep.
export function useBlob(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  voice: Voice,
  onWake?: () => void,
) {
  // Kept in a ref so a new callback doesn't restart the animation.
  const onWakeRef = useRef(onWake)
  useEffect(() => {
    onWakeRef.current = onWake
  }, [onWake])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dots: Dot[] = generateDots(DOT_COUNT)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    let rafId = 0
    const startTime = performance.now()

    // Sleep state. lastActivity is the last voice, click or mouse move.
    let lastActivity = startTime
    let yawnStart = -1
    let asleep = false
    let sleep = 0 // 0 awake, 1 fully asleep (eased)
    let squint = 0 // 0 to YAWN_SQUINT (eased)
    let breathePhase = 0

    const wake = () => {
      lastActivity = performance.now()
    }

    let nextBlinkAt = startTime + nextBlinkDelay()
    let blinkStart = -1
    let isSecondBlink = false

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId)
      } else {
        rafId = requestAnimationFrame(frame)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Where the pupils should look, in canvas pixels. null means straight
    // ahead (no pointer, or a finger was lifted).
    let lookTarget: { x: number; y: number } | null = null
    // Current pupil offset, from -1 to 1 on each axis.
    let lookX = 0
    let lookY = 0
    let lastFrame = startTime

    // Where a pointer event lands relative to the blob: its offset from the
    // centre, and whether it is inside the blob's outline.
    const hitTest = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const dx = e.clientX - rect.left - width / 2
      const dy = e.clientY - rect.top - height / 2
      const dist = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx)
      const baseRadius = Math.min(width, height) * BLOB_RADIUS
      const inside = dist <= baseRadius * edgeRadius(angle)
      return { dx, dy, dist, angle, baseRadius, inside }
    }

    const onPointerMove = (e: PointerEvent) => {
      wake()
      const hit = hitTest(e)
      lookTarget = { x: hit.dx + width / 2, y: hit.dy + height / 2 }
      // A pointing hand over the blob hints that it can be poked.
      if (e.pointerType === 'mouse') canvas.style.cursor = hit.inside ? 'pointer' : ''
    }
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') lookTarget = null
    }
    const onPointerLeave = () => {
      lookTarget = null
    }

    // Squash amount (0 = round) and its speed. The blob squashes along the
    // line from its centre to where it was poked.
    let squash = 0
    let squashVel = 0
    let pokeAngle = Math.PI / 2

    const onPointerDown = (e: PointerEvent) => {
      onPointerMove(e)
      const { dist, angle, baseRadius, inside } = hitTest(e)
      if (!inside) return
      // A poke right in the middle squashes it from the top.
      pokeAngle = dist > baseRadius * 0.15 ? angle : Math.PI / 2
      squashVel += reduceMotion ? POKE_IMPULSE_REDUCED : POKE_IMPULSE
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
    document.documentElement.addEventListener('mouseleave', onPointerLeave)

    function frame(now: number) {
      // Capped so the pupils don't jump after the tab was hidden.
      const dt = Math.min((now - lastFrame) / 1000, 0.1)
      lastFrame = now
      const cx = width / 2
      const cy = height / 2
      const baseRadius = Math.min(width, height) * BLOB_RADIUS

      voice.update(dt)

      // Sleep and yawn. Wait SLEEP_AFTER with no activity, yawn, then
      // drift off. Activity resets the timer and cancels it all.
      if (voice.loudness > WAKE_LOUDNESS) wake()
      let yawn = 0
      let squintTarget = 0
      if (now - lastActivity < SLEEP_AFTER) {
        if (asleep) onWakeRef.current?.()
        yawnStart = -1
        asleep = false
      } else if (!asleep) {
        if (yawnStart < 0) yawnStart = now
        const p = (now - yawnStart) / YAWN_DURATION
        yawn = yawnCurve(Math.min(p, 1))
        // Eyes stay heavy after the yawn instead of popping back open.
        squintTarget = YAWN_SQUINT * smoothstep(0, 0.35, p)
        if (p >= 1) asleep = true
      }
      if (asleep) squintTarget = YAWN_SQUINT
      sleep += ((asleep ? 1 : 0) - sleep) * (1 - Math.exp(-dt * (asleep ? FALL_ASLEEP_RATE : WAKE_RATE)))
      squint += (squintTarget - squint) * (1 - Math.exp(-dt * SQUINT_EASE))

      // Breathing slows and deepens as it sleeps.
      breathePhase += dt * lerp(BREATHE_SPEED, BREATHE_SPEED_ASLEEP, sleep)
      const breatheDepth = lerp(BREATHE_DEPTH, BREATHE_DEPTH_ASLEEP, sleep)
      const breathe = reduceMotion ? 0 : Math.sin(breathePhase) * breatheDepth
      const shrink = reduceMotion ? 1 : 1 - sleep * ASLEEP_SHRINK
      const scale = (1 + breathe) * shrink
      // The yawn stretches the blob up and pulls it in at the sides.
      const stretch = reduceMotion ? 0 : yawn * YAWN_STRETCH
      const stretchX = 1 - stretch / 2
      const stretchY = 1 + stretch
      const dim = 1 - sleep * ASLEEP_DIM
      const grow = 1 + voice.loudness * VOICE_GROW
      const spread = voice.loudness * VOICE_SPREAD
      const presence = smoothstep(0, VOICE_PRESENT, voice.loudness)
      const lavender = voice.brightness * presence * VOICE_LAVENDER

      const damping = reduceMotion ? POKE_DAMPING_REDUCED : POKE_DAMPING
      for (let left = dt; left > 0; left -= SPRING_STEP) {
        const step = Math.min(left, SPRING_STEP)
        squashVel += (-POKE_STIFFNESS * squash - damping * squashVel) * step
        squash += squashVel * step
      }
      squash = Math.min(Math.max(squash, -POKE_MAX_SQUASH), POKE_MAX_SQUASH)

      // Squash along the poke line and bulge across it, keeping the area
      // roughly the same, like pressing on jelly.
      const pokeCos = Math.cos(pokeAngle)
      const pokeSin = Math.sin(pokeAngle)
      const along = 1 - squash
      const across = 1 + squash
      const squish = (ox: number, oy: number): [number, number] => {
        const a = (ox * pokeCos + oy * pokeSin) * along
        const b = (oy * pokeCos - ox * pokeSin) * across
        return [cx + a * pokeCos - b * pokeSin, cy + a * pokeSin + b * pokeCos]
      }

      ctx.clearRect(0, 0, width, height)
      ctx.globalAlpha = dim

      for (const dot of dots) {
        // Same as squish(), inlined because it runs for every dot.
        const r = dot.distance * baseRadius * scale * grow * (1 + spread * dot.spread)
        const ox = Math.cos(dot.angle) * r * stretchX
        const oy = Math.sin(dot.angle) * r * stretchY
        const a = (ox * pokeCos + oy * pokeSin) * along
        const b = (oy * pokeCos - ox * pokeSin) * across
        const x = cx + a * pokeCos - b * pokeSin
        const y = cy + a * pokeSin + b * pokeCos
        ctx.fillStyle = blobColor(dot.distance, 1, lavender)
        ctx.beginPath()
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }

      // Blink timing: wait for the next scheduled blink, play it, then
      // occasionally follow up with a quick second blink. No blinking
      // while yawning or asleep.
      if (yawnStart >= 0 || asleep) {
        nextBlinkAt = Math.max(nextBlinkAt, now + BLINK_MIN_GAP)
      }
      if (now >= nextBlinkAt && blinkStart < 0) {
        blinkStart = now
      }
      let openness = 1
      if (blinkStart >= 0) {
        const elapsed = now - blinkStart
        if (elapsed >= BLINK_DURATION) {
          blinkStart = -1
          const doubleBlink = !isSecondBlink && Math.random() < DOUBLE_BLINK_CHANCE
          isSecondBlink = doubleBlink
          nextBlinkAt = now + (doubleBlink ? DOUBLE_BLINK_GAP : nextBlinkDelay())
        } else {
          openness = blinkOpenness(elapsed)
        }
      }
      if (reduceMotion) openness = 1
      // Squint from the yawn, then shut as it falls asleep.
      openness *= (1 - squint) * (1 - smoothstep(0, 0.6, sleep))

      const eyeRadius = baseRadius * EYE_RADIUS
      const eyeY = cy - baseRadius * EYE_RAISE
      const eyeSpacing = baseRadius * EYE_SPACING
      const eyeDistance = Math.hypot(EYE_SPACING, EYE_RAISE)
      const patchColor = blobColor(eyeDistance, 1, lavender)
      const patchEdge = blobColor(eyeDistance, 0, lavender)

      // Open eye fades into a lid line as it nears shut, so a closed eye
      // reads as closed rather than vanishing.
      const eyeAlpha = smoothstep(0.1, 0.3, openness)

      // Both pupils look the same way, toward the pointer from the point
      // between the eyes, easing so they glide rather than snap.
      let targetX = 0
      let targetY = 0
      if (lookTarget) {
        const dx = lookTarget.x - cx
        const dy = lookTarget.y - eyeY
        const dist = Math.hypot(dx, dy)
        if (dist > 0) {
          const reach = Math.min(dist / (baseRadius * LOOK_FULL_REACH), 1)
          targetX = (dx / dist) * reach
          targetY = (dy / dist) * reach
        }
      }
      const ease = 1 - Math.exp(-dt * LOOK_EASE)
      lookX += (targetX - lookX) * ease
      lookY += (targetY - lookY) * ease
      const pupilDx = lookX * eyeRadius * LOOK_MAX_X
      const pupilDy = lookY * eyeRadius * LOOK_MAX_Y
      const highlightAlpha = smoothstep(0.5, 0.9, openness)

      for (const dir of [-1, 1]) {
        // The eyes ride along with the squish so they stay on the face.
        // They also move apart a little as the blob grows with your voice.
        // And they follow the yawn stretch and the sleepy shrink.
        const size = grow * scale
        const [ex, ey] = squish(dir * eyeSpacing * size * stretchX, (eyeY - cy) * size * stretchY)

        const patchRadius = eyeRadius * EYE_PATCH_RADIUS
        const patch = ctx.createRadialGradient(ex, ey, 0, ex, ey, patchRadius)
        patch.addColorStop(0, patchColor)
        patch.addColorStop(0.65, patchColor)
        patch.addColorStop(1, patchEdge)
        ctx.globalAlpha = dim
        ctx.fillStyle = patch
        ctx.beginPath()
        ctx.arc(ex, ey, patchRadius, 0, Math.PI * 2)
        ctx.fill()

        // The pupil, lid and highlight move together; the patch stays put.
        const px = ex + pupilDx
        const py = ey + pupilDy

        // The lid comes down from the top: the eye's bottom edge stays put.
        const ry = eyeRadius * openness
        const eyeCy = py + eyeRadius - ry

        if (eyeAlpha > 0) {
          ctx.globalAlpha = eyeAlpha * dim
          ctx.fillStyle = EYE_COLOR
          ctx.beginPath()
          ctx.ellipse(px, eyeCy, eyeRadius, Math.max(ry, 0.5), 0, 0, Math.PI * 2)
          ctx.fill()
        }

        if (eyeAlpha < 1) {
          // Not dimmed: it's dark already, and a faint lid on a dimmed
          // patch made it hard to tell the eyes were shut.
          ctx.globalAlpha = 1 - eyeAlpha
          ctx.strokeStyle = EYE_COLOR
          ctx.lineWidth = eyeRadius * EYE_LID_WIDTH
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.arc(px, py, eyeRadius, Math.PI * 0.2, Math.PI * 0.8)
          ctx.stroke()
        }

        if (highlightAlpha > 0) {
          ctx.globalAlpha = highlightAlpha * dim
          ctx.fillStyle = EYE_HIGHLIGHT
          ctx.beginPath()
          ctx.arc(
            px - eyeRadius * 0.35,
            eyeCy - ry * 0.35,
            eyeRadius * EYE_HIGHLIGHT_RADIUS,
            0,
            Math.PI * 2,
          )
          ctx.fill()
        }

        ctx.globalAlpha = 1
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      document.documentElement.removeEventListener('mouseleave', onPointerLeave)
    }
  }, [canvasRef, voice])
}
