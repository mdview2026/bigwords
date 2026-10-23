import qrcode from 'qrcode-generator';

const QUIET_ZONE = 4;

/**
 * The QR code's dark modules as one SVG path-data string, drawn in a
 * (n + 8)² box that includes the standard four-module quiet zone. Pure: the
 * landing page prerender builds its QR from this at build time, in Node.
 * Null when the data does not fit a QR code.
 */
export function qrPathData(text: string): { d: string; size: number } | null {
  try {
    const qr = qrcode(0, 'M');
    // The library maps each char code to one byte, so feed it UTF-8 bytes.
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    qr.addData(binary, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { d, size: n + QUIET_ZONE * 2 };
  } catch {
    return null;
  }
}

/**
 * Build a QR code as an SVG element: black modules on white with the standard
 * four-module quiet zone, so it scans regardless of the display colors.
 */
export function createQrSvg(text: string): SVGSVGElement | null {
  const qr = qrPathData(text);
  if (qr === null) return null;
  const { d, size } = qr;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#ffffff');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000000');
  svg.append(bg, path);
  return svg;
}
