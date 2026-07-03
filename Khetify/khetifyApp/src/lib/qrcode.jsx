import React, { useEffect, useRef, useState } from 'react';

/**
 * Renders `value` as a QR code on a canvas. The tiny qrcode-generator UMD
 * (~15KB) is loaded once from a CDN and cached — same zero-install pattern as
 * the camera decoder. QR is what the receiving camera scans: a 90-char
 * manifest payload is trivial for QR but unreadable as a camera-scanned 1D
 * barcode.
 *
 *   <QrCode value={qrPayload} size={180} />
 */
const QR_URLS = [
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js',
];

let qrPromise = null;
function loadQrLib() {
  if (typeof window !== 'undefined' && window.qrcode) return Promise.resolve(window.qrcode);
  if (qrPromise) return qrPromise;
  qrPromise = new Promise((resolve, reject) => {
    const tryUrl = (i) => {
      if (i >= QR_URLS.length) { qrPromise = null; reject(new Error('qr lib unavailable')); return; }
      const el = document.createElement('script');
      el.src = QR_URLS[i];
      el.async = true;
      el.onload = () => (window.qrcode ? resolve(window.qrcode) : tryUrl(i + 1));
      el.onerror = () => { el.remove(); tryUrl(i + 1); };
      document.head.appendChild(el);
    };
    tryUrl(0);
  });
  return qrPromise;
}

const QrCode = ({ value = '', size = 180, className = '' }) => {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!value) return undefined;
    loadQrLib()
      .then((qrcode) => {
        if (cancelled || !ref.current) return;
        const qr = qrcode(0, 'M'); // type 0 = auto-size, M error correction
        qr.addData(String(value));
        qr.make();
        const n = qr.getModuleCount();
        const canvas = ref.current;
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        const quiet = 4; // quiet-zone modules
        const cell = size / (n + quiet * 2);
        ctx.fillStyle = '#000';
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            if (qr.isDark(r, c)) {
              ctx.fillRect(Math.round((c + quiet) * cell), Math.round((r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
            }
          }
        }
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [value, size]);

  if (failed) return null; // the Code-128 + text payload remain as fallback
  return <canvas ref={ref} width={size} height={size} className={className} style={{ imageRendering: 'pixelated' }} />;
};

export default QrCode;
