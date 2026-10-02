// QR codes for offline pairing: drawing them, and reading them with the camera. Both libraries load on demand.

/** A QR code as a canvas, one pixel per module with a 4-module quiet zone (scale it up when drawing). */
export async function qrCanvas(text: string): Promise<HTMLCanvasElement> {
  const qrcode = (await import('qrcode-generator')).default;
  const qr = qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), q = 4;
  const c = document.createElement('canvas');
  c.width = c.height = n + q * 2;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) ctx.fillRect(x + q, y + q, 1, 1);
  return c;
}

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }

/** Reads QR codes from the back camera. The video is drawn by whoever shows it (the game's UI canvas). */
export class QrScanner {
  video = document.createElement('video');
  private stream: MediaStream | null = null;
  private frame = document.createElement('canvas');
  private detector: Detector | null = null;
  private jsqr: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
  private busy = false;
  stopped = false;

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access (paste the code instead)');
    const B = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (B) this.detector = new B({ formats: ['qr_code'] });
    else this.jsqr = (await import('jsqr')).default as unknown as typeof this.jsqr;
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    const v = this.video;
    v.setAttribute('playsinline', '');
    v.muted = true;
    // iOS only plays videos that are in the page
    v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    v.srcObject = this.stream;
    await v.play();
  }

  /** Look for a code in the current frame. */
  async scan(): Promise<string | null> {
    const v = this.video;
    if (this.busy || this.stopped || v.readyState < 2 || !v.videoWidth) return null;
    this.busy = true;
    try {
      if (this.detector) {
        const r = await this.detector.detect(v);
        return r[0]?.rawValue ?? null;
      }
      const w = Math.min(640, v.videoWidth), h = Math.round((v.videoHeight / v.videoWidth) * w);
      this.frame.width = w;
      this.frame.height = h;
      const ctx = this.frame.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, w, h);
      return this.jsqr?.(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
    } catch {
      return null;
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.stopped = true;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.video.remove();
  }
}
