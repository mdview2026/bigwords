/** Longest edge of the frame handed to the decoder: enough for a screen-sized code, cheap enough to run repeatedly. */
const SCAN_MAX_EDGE = 640;
/** Gap between decodes. The camera runs faster than a hand needs to re-read the same code. */
const SCAN_INTERVAL_MS = 120;

/**
 * Open the camera and read QR codes until the returned stop function runs.
 *
 * `onCode` answers whether the code was accepted: true ends the scan, false
 * keeps the camera reading so a wrong code (some other app's QR) does not
 * kill the session. The same rejected code is not reported again for a
 * couple of seconds, or the toast would fire once per frame.
 *
 * Frames are decoded in JavaScript (jsQR) rather than with the browser's
 * BarcodeDetector: that interface is experimental, and in the Android app's
 * WebView it exists but never returns a code, so scanning silently did
 * nothing there. Reading the frames ourselves works wherever a camera opens.
 */
export async function startScanner(video: HTMLVideoElement, onCode: (text: string) => boolean): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-scanner');
  const { default: decodeQr } = await import('jsqr');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  const stopCamera = () => {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
  try {
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    stopCamera();
    throw error;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    stopCamera();
    throw new Error('no-canvas');
  }
  let timer = 0;
  let found = false;
  let lastText = '';
  let lastAt = 0;
  const tick = () => {
    if (found) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw > 0 && vh > 0) {
      const scale = Math.min(1, SCAN_MAX_EDGE / Math.max(vw, vh));
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const code = decodeQr(data, w, h, { inversionAttempts: 'dontInvert' });
      if (code?.data) {
        const now = Date.now();
        if (code.data !== lastText || now - lastAt > 2000) {
          lastText = code.data;
          lastAt = now;
          if (onCode(code.data)) {
            found = true;
            return;
          }
        }
      }
    }
    timer = window.setTimeout(tick, SCAN_INTERVAL_MS);
  };
  tick();
  return () => {
    found = true;
    clearTimeout(timer);
    stopCamera();
  };
}
