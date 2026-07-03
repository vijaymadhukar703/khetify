import React, { useEffect, useRef, useState } from 'react';

/**
 * Device-camera barcode/QR scanner. Layered decoding so it works everywhere:
 *  1. Browser-native BarcodeDetector (Chrome on Android/macOS) — fastest,
 *     reads QR + 1D barcodes.
 *  2. jsQR (tiny JS QR decoder, loaded on demand from a CDN and cached) —
 *     covers Windows/desktop browsers where BarcodeDetector doesn't exist.
 *     The transfer manifest is a QR code, so this fully covers receiving.
 * Camera preview itself only needs getUserMedia, which every modern browser
 * has on https:// or localhost.
 *
 *   <CameraScanner onDetected={(code) => ...} onClose={() => ...} />
 *
 * Calls onDetected ONCE with the first decoded value, then stops the camera.
 */
export const cameraScanSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

const JSQR_URLS = [
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
];

let jsqrPromise = null;
/** Load the jsQR UMD bundle once and cache it (window.jsQR). */
function loadJsQR() {
  if (typeof window !== 'undefined' && window.jsQR) return Promise.resolve(window.jsQR);
  if (jsqrPromise) return jsqrPromise;
  jsqrPromise = new Promise((resolve, reject) => {
    const tryUrl = (i) => {
      if (i >= JSQR_URLS.length) { jsqrPromise = null; reject(new Error('decoder unavailable')); return; }
      const el = document.createElement('script');
      el.src = JSQR_URLS[i];
      el.async = true;
      el.onload = () => (window.jsQR ? resolve(window.jsQR) : tryUrl(i + 1));
      el.onerror = () => { el.remove(); tryUrl(i + 1); };
      document.head.appendChild(el);
    };
    tryUrl(0);
  });
  return jsqrPromise;
}

const CameraScanner = ({ onDetected, onClose, hint = 'Point the camera at the barcode' }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const doneRef = useRef(false);
  const [status, setStatus] = useState('starting'); // starting | scanning | error
  const [error, setError] = useState(
    cameraScanSupported() ? null : 'Camera access is not available in this browser — type or wedge-scan the code instead.'
  );

  useEffect(() => {
    if (error) return undefined;
    let raf;
    let timer;
    let cancelled = false;

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const finish = (value) => {
      if (doneRef.current) return;
      doneRef.current = true;
      stop();
      onDetected?.(value);
    };

    (async () => {
      try {
        // 1) camera preview
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        // 2) pick a decoder
        const hasNative = typeof window !== 'undefined' && 'BarcodeDetector' in window;
        let nativeDetector = null;
        let jsQR = null;
        if (hasNative) {
          try {
            nativeDetector = new window.BarcodeDetector({
              formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'],
            });
          } catch { nativeDetector = null; }
        }
        if (!nativeDetector) {
          try { jsQR = await loadJsQR(); }
          catch {
            setError('Could not load the barcode decoder (no internet?) — type or wedge-scan the code instead.');
            stop();
            return;
          }
        }
        if (cancelled) { stop(); return; }
        setStatus('scanning');

        // 3) scan loop
        const tickNative = async () => {
          if (cancelled || doneRef.current) return;
          try {
            if (video.readyState >= 2) {
              const codes = await nativeDetector.detect(video);
              const value = codes?.[0]?.rawValue?.trim();
              if (value) return finish(value);
            }
          } catch { /* keep scanning */ }
          raf = requestAnimationFrame(tickNative);
        };

        const tickJsQR = () => {
          if (cancelled || doneRef.current) return;
          try {
            if (video.readyState >= 2 && video.videoWidth) {
              const canvas = canvasRef.current;
              // downscale for speed; jsQR handles small frames well
              const w = Math.min(video.videoWidth, 640);
              const h = Math.round((video.videoHeight / video.videoWidth) * w);
              canvas.width = w; canvas.height = h;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const code = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
              const value = code?.data?.trim();
              if (value) return finish(value);
            }
          } catch { /* keep scanning */ }
          timer = setTimeout(tickJsQR, 120); // ~8 fps is plenty for QR
        };

        if (nativeDetector) raf = requestAnimationFrame(tickNative);
        else tickJsQR();
      } catch (e) {
        setError(
          e?.name === 'NotAllowedError'
            ? 'Camera permission denied — allow camera access in the address bar, or type the code instead.'
            : e?.name === 'NotFoundError'
              ? 'No camera found on this device — type or wedge-scan the code instead.'
              : 'Could not open the camera — type or wedge-scan the code instead.'
        );
        stop();
      }
    })();

    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <p className="text-sm font-bold text-stone-900 flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-[#EA2831]">qr_code_scanner</span>
            Scan with camera
          </p>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {error ? (
          <p className="p-6 text-sm text-stone-500">{error}</p>
        ) : (
          <div className="relative bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted className="w-full max-h-[60vh] object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-56 h-36 border-2 border-white/80 rounded-xl" />
            </div>
            <p className="absolute bottom-2 inset-x-0 text-center text-[11px] text-white/90">
              {status === 'starting' ? 'Starting camera…' : hint}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraScanner;
