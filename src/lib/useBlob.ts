import { useEffect, type RefObject } from 'react'
import { edgeRadius, generateDots, type Dot } from './blobDots'

const MAX_DPR = 2
// Blob radius as a fraction of the canvas size.
const BLOB_RADIUS = 0.38
const DOT_COUNT = 1500
const DOT_RADIUS = 1.6

const PEACH = { r: 0xff, g: 0xb9, b: 0x96 }
const PINK = { r: 0xff, g: 0x8f, b: 0xa3 }
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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function blobColor(t: number, alpha = 1) {
  const r = Math.round(lerp(PEACH.r, PINK.r, t))
  const g = Math.round(lerp(PEACH.g, PINK.g, t))
  const b = Math.round(lerp(PEACH.b, PINK.b, t))
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

function nextBlinkDelay() {
  return BLINK_MIN_GAP + Math.random() * (BLINK_MAX_GAP - BLINK_MIN_GAP)
}

export function useBlob(canvasRef: RefObject<HTMLCanvasElement | null>) {
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

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      lookTarget = { x: e.clientX - rect.left, y: e.clientY - rect.top }
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
      const rect = canvas.getBoundingClientRect()
      const dx = e.clientX - rect.left - width / 2
      const dy = e.clientY - rect.top - height / 2
      const dist = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx)
      const baseRadius = Math.min(width, height) * BLOB_RADIUS
      if (dist > baseRadius * edgeRadius(angle)) return
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
      const t = (now - startTime) / 1000
      // Capped so the pupils don't jump after the tab was hidden.
      const dt = Math.min((now - lastFrame) / 1000, 0.1)
      lastFrame = now
      const cx = width / 2
      const cy = height / 2
      const baseRadius = Math.min(width, height) * BLOB_RADIUS

      const breathe = reduceMotion ? 0 : Math.sin(t * 0.6) * 0.035
      const scale = 1 + breathe

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

      for (const dot of dots) {
        // Same as squish(), inlined because it runs for every dot.
        const r = dot.distance * baseRadius * scale
        const ox = Math.cos(dot.angle) * r
        const oy = Math.sin(dot.angle) * r
        const a = (ox * pokeCos + oy * pokeSin) * along
        const b = (oy * pokeCos - ox * pokeSin) * across
        const x = cx + a * pokeCos - b * pokeSin
        const y = cy + a * pokeSin + b * pokeCos
        ctx.fillStyle = blobColor(dot.distance)
        ctx.beginPath()
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }

      // Blink timing: wait for the next scheduled blink, play it, then
      // occasionally follow up with a quick second blink.
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

      const eyeRadius = baseRadius * EYE_RADIUS
      const eyeY = cy - baseRadius * EYE_RAISE
      const eyeSpacing = baseRadius * EYE_SPACING
      const eyeDistance = Math.hypot(EYE_SPACING, EYE_RAISE)
      const patchColor = blobColor(eyeDistance)
      const patchEdge = blobColor(eyeDistance, 0)

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
        const [ex, ey] = squish(dir * eyeSpacing, eyeY - cy)

        const patchRadius = eyeRadius * EYE_PATCH_RADIUS
        const patch = ctx.createRadialGradient(ex, ey, 0, ex, ey, patchRadius)
        patch.addColorStop(0, patchColor)
        patch.addColorStop(0.65, patchColor)
        patch.addColorStop(1, patchEdge)
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
          ctx.globalAlpha = eyeAlpha
          ctx.fillStyle = EYE_COLOR
          ctx.beginPath()
          ctx.ellipse(px, eyeCy, eyeRadius, Math.max(ry, 0.5), 0, 0, Math.PI * 2)
          ctx.fill()
        }

        if (eyeAlpha < 1) {
          ctx.globalAlpha = 1 - eyeAlpha
          ctx.strokeStyle = EYE_COLOR
          ctx.lineWidth = eyeRadius * EYE_LID_WIDTH
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.arc(px, py, eyeRadius, Math.PI * 0.2, Math.PI * 0.8)
          ctx.stroke()
        }

        if (highlightAlpha > 0) {
          ctx.globalAlpha = highlightAlpha
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
  }, [canvasRef])
}
