// Vendor logos, redrawn on a canvas so the menu buttons and the 3D chassis share one source.
// Close recreations for training realism; DCT Training is not affiliated with any vendor.
import { useEffect, useRef } from 'react';
import type { VendorId } from '../engine/vendors';

const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

/** Draws the vendor mark centred in (x, y, w, h). `mono` paints it in one colour (e.g. silver on a bezel). */
export function drawLogo(g: CanvasRenderingContext2D, v: VendorId, x: number, y: number, w: number, h: number, mono?: string) {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  if (v === 'dell') {
    // DELL wordmark with the E tilted back
    const s = Math.min(h * 0.9, w / 3.1);
    g.font = `800 ${s}px ${FONT}`;
    g.fillStyle = mono ?? '#0076ce';
    const parts = ['D', 'E', 'L', 'L'];
    const widths = parts.map((c) => g.measureText(c).width);
    const gap = s * 0.02;
    const total = widths.reduce((a, b) => a + b, 0) + gap * 3;
    let cx = -total / 2;
    parts.forEach((c, i) => {
      const cw = widths[i];
      g.save();
      g.translate(cx + cw / 2, 0);
      if (i === 1) g.rotate(-0.42);
      g.fillText(c, 0, s * 0.04);
      g.restore();
      cx += cw + gap;
    });
  } else if (v === 'hpe') {
    // the green "element" rectangle above a bold HPE wordmark
    const s = Math.min(h * 0.55, w / 3.4);
    const rw = s * 2.1;
    const rh = h * 0.3;
    const lw = Math.max(1.5, s * 0.16);
    g.strokeStyle = mono ?? '#01a982';
    g.lineWidth = lw;
    g.strokeRect(-rw / 2, -h / 2 + lw, rw, rh);
    g.font = `800 ${s}px ${FONT}`;
    g.fillStyle = mono ?? '#ffffff';
    g.fillText('HPE', 0, -h / 2 + lw + rh + s * 0.62);
  } else if (v === 'supermicro') {
    const s = Math.min(h * 0.62, w / 7.2);
    g.font = `italic 800 ${s}px ${FONT}`;
    g.fillStyle = mono ?? '#ffffff';
    g.fillText('SUPERMICRO', 0, 0);
    if (!mono) {
      g.fillStyle = '#3d8b3d';
      const tw = g.measureText('SUPERMICRO').width;
      g.fillRect(-tw / 2, s * 0.5, tw * 0.34, s * 0.12);
    }
  } else {
    // Lenovo: white wordmark on a red bar
    const s = Math.min(h * 0.6, w / 4.2);
    g.font = `700 ${s}px ${FONT}`;
    const tw = g.measureText('Lenovo').width;
    if (!mono) {
      g.fillStyle = '#e2231a';
      g.fillRect(-tw / 2 - s * 0.35, -s * 0.72, tw + s * 0.7, s * 1.44);
    }
    g.fillStyle = mono ?? '#ffffff';
    g.fillText('Lenovo', 0, s * 0.04);
  }
  g.restore();
}

/** A crisp logo for HTML (renders at device pixel ratio). */
export function VendorLogo({ vendor, width = 120, height = 36, mono }: { vendor: VendorId; width?: number; height?: number; mono?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = height * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, height);
    drawLogo(g, vendor, 0, 0, width, height, mono);
  }, [vendor, width, height, mono]);
  return <canvas ref={ref} style={{ width, height, display: 'block' }} aria-label={`${vendor} logo`} role="img" />;
}
