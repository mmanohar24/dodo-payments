export interface Dot {
  angle: number
  distance: number // 0-1, fraction of the blob's radius at this angle
  spread: number // 0-1, how far this dot drifts out when the blob is loud
}

// A few sine harmonics layered on the edge radius give the blob a soft,
// irregular outline instead of a perfect circle.
const EDGE_HARMONICS = [
  { amp: 0.06, freq: 2, phase: 0.4 },
  { amp: 0.04, freq: 3, phase: 2.1 },
  { amp: 0.03, freq: 5, phase: 1.0 },
]

export function edgeRadius(angle: number): number {
  let r = 1
  for (const h of EDGE_HARMONICS) {
    r += h.amp * Math.sin(angle * h.freq + h.phase)
  }
  return r
}

export function generateDots(count: number): Dot[] {
  const dots: Dot[] = []
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const maxR = edgeRadius(angle)
    // sqrt keeps the dots evenly spread by area, not bunched at the center
    const distance = Math.sqrt(Math.random()) * maxR
    dots.push({ angle, distance, spread: Math.random() })
  }
  return dots
}
