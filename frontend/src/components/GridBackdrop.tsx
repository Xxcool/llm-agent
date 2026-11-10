import { useEffect, useRef } from 'react'

/**
 * DeepSeek 式首屏背景：
 * 1) 顶部蓝色渐隐（#9cc1e7 → 透明）
 * 2) 细网格 canvas
 * 3) 流场粒子 canvas（缓慢漂移的小点）
 * 两层 canvas 通过 mask 向下淡出，避免底部干扰内容。
 */
export function GridBackdrop() {
  const gridRef = useRef<HTMLCanvasElement>(null)
  const flowRef = useRef<HTMLCanvasElement>(null)

  // 网格：静态绘制，随尺寸重绘
  useEffect(() => {
    const canvas = gridRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const gap = 64
      ctx.strokeStyle = 'rgba(58, 92, 148, 0.05)'
      ctx.lineWidth = 1
      for (let x = 0; x <= w; x += gap) {
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, 0)
        ctx.lineTo(Math.round(x) + 0.5, h)
        ctx.stroke()
      }
      for (let y = 0; y <= h; y += gap) {
        ctx.beginPath()
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(w, Math.round(y) + 0.5)
        ctx.stroke()
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // 流场粒子：sin/cos 伪噪声驱动的缓慢漂移
  useEffect(() => {
    const canvas = flowRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let w = 0
    let h = 0
    const dpr = window.devicePixelRatio || 1
    const COUNT = 70

    const particles = Array.from({ length: COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.6 + 0.9,
      p: Math.random() * Math.PI * 2,
    }))

    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let t = 0
    const tick = () => {
      t += 0.0022
      ctx.clearRect(0, 0, w, h)
      for (const p of particles) {
        const angle =
          Math.sin(p.x * 4.2 + t * 6) * 0.9 + Math.cos(p.y * 3.4 - t * 4) * 0.9
        p.x += Math.cos(angle) * 0.0009
        p.y += Math.sin(angle) * 0.0009 + 0.00035
        if (p.x < -0.02) p.x = 1.02
        if (p.x > 1.02) p.x = -0.02
        if (p.y > 1.02) p.y = -0.02
        ctx.beginPath()
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(80, 116, 185, ${0.08 + 0.07 * Math.sin(p.p + t * 3)})`
        ctx.fill()
      }
      raf = requestAnimationFrame(tick)
    }

    if (!reduce) raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return (
    <div className="backdrop" aria-hidden>
      <div className="backdrop-wash" />
      <div className="backdrop-layer">
        <canvas ref={gridRef} className="backdrop-canvas" />
      </div>
      <div className="backdrop-layer">
        <canvas ref={flowRef} className="backdrop-canvas" />
      </div>
    </div>
  )
}
