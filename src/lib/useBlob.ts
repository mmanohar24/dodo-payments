import { useEffect, type RefObject } from 'react'
import { generateDots, type Dot } from './blobDots'

const MAX_DPR = 2
const DOT_COUNT = 1500
const DOT_RADIUS = 1.6

const PEACH = { r: 0xff, g: 0xb9, b: 0x96 }
const PINK = { r: 0xff, g: 0x8f, b: 0xa3 }
const EYE_COLOR = '#0b1026'

const BLINK_DURATION = 160
const BLINK_MIN_GAP = 2500
const BLINK_MAX_GAP = 6000

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function blobColor(t: number) {
  const r = Math.round(lerp(PEACH.r, PINK.r, t))
  const g = Math.round(lerp(PEACH.g, PINK.g, t))
  const b = Math.round(lerp(PEACH.b, PINK.b, t))
  return `rgb(${r}, ${g}, ${b})`
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

    let nextBlinkAt = startTime + BLINK_MIN_GAP + Math.random() * (BLINK_MAX_GAP - BLINK_MIN_GAP)
    let blinkStart = -1

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId)
      } else {
        rafId = requestAnimationFrame(frame)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    function frame(now: number) {
      const t = (now - startTime) / 1000
      const cx = width / 2
      const cy = height / 2
      const baseRadius = Math.min(width, height) * 0.38

      const breathe = reduceMotion ? 0 : Math.sin(t * 0.6) * 0.035
      const scale = 1 + breathe

      ctx.clearRect(0, 0, width, height)

      for (const dot of dots) {
        const r = dot.distance * baseRadius * scale
        const x = cx + Math.cos(dot.angle) * r
        const y = cy + Math.sin(dot.angle) * r
        ctx.fillStyle = blobColor(dot.distance)
        ctx.beginPath()
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }

      // Blink timing: wait for the next scheduled blink, then play a quick
      // close-and-open over BLINK_DURATION before scheduling the next one.
      if (now >= nextBlinkAt && blinkStart < 0) {
        blinkStart = now
      }
      let blinkT = 0
      if (blinkStart >= 0) {
        const elapsed = now - blinkStart
        if (elapsed >= BLINK_DURATION) {
          blinkStart = -1
          nextBlinkAt = now + BLINK_MIN_GAP + Math.random() * (BLINK_MAX_GAP - BLINK_MIN_GAP)
        } else {
          const p = elapsed / BLINK_DURATION
          blinkT = p < 0.5 ? p * 2 : (1 - p) * 2
        }
      }

      const eyeOpenness = reduceMotion ? 1 : 1 - blinkT * 0.92
      const eyeSpacing = baseRadius * 0.34
      const eyeY = cy - baseRadius * 0.12
      const eyeRadius = baseRadius * 0.07

      for (const dir of [-1, 1]) {
        const ex = cx + dir * eyeSpacing
        ctx.save()
        ctx.translate(ex, eyeY)
        ctx.scale(1, Math.max(eyeOpenness, 0.06))
        ctx.beginPath()
        ctx.arc(0, 0, eyeRadius, 0, Math.PI * 2)
        ctx.fillStyle = EYE_COLOR
        ctx.fill()
        ctx.restore()
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [canvasRef])
}
