import React, { useEffect, useRef, useState } from 'react';
import CameraScanner, { cameraScanSupported } from './CameraScanner';

/**
 * Universal scan input. USB barcode scanners act as keyboard wedges — they type
 * the code very fast and emit Enter. This component:
 *   - keeps focus so a scan is always captured
 *   - debounces manual typing vs. a scanner burst (a real scan arrives in one go)
 *   - fires onScan(code, { source }) on Enter (or on a fast burst terminator).
 *     `source` is 'scan' for a barcode/QR (fast wedge burst or the camera) and
 *     'manual' for human typing / paste / the optional Add button — so callers
 *     can label an entry "Scanned" vs "Manually Added" while processing both the
 *     same way. Existing callers that read only the first arg are unaffected.
 *   - offers DEVICE-CAMERA scanning (BarcodeDetector) where the browser
 *     supports it — a camera button opens a live preview overlay and feeds the
 *     decoded code through the same onScan path. Pass camera={false} to hide.
 *   - optionally renders an "Add" button (showAdd) for touch/manual submit.
 *
 *   <ScanBox onScan={(code, meta) => resolve(code, meta.source)} placeholder="…" />
 */
// A wedge scanner types the whole code in a single fast burst; a human types far
// slower. Under this many ms/char (averaged over the burst) we treat it as a scan.
const SCAN_MS_PER_CHAR = 40;

const ScanBox = ({ onScan, onValueChange, placeholder = 'Scan or type a code, then Enter', autoFocus = true, disabled = false, camera = true, showAdd = false }) => {
  const [value, setValue] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const ref = useRef(null);
  const firstKeyTs = useRef(0); // timestamp of the first char keystroke of the burst
  const keyCount = useRef(0);   // char keystrokes since the field was last cleared

  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);

  // source: 'scan' (barcode/QR) or 'manual' (typed / pasted / Add button).
  const submit = (code, source = 'manual') => {
    const c = String(code || '').trim();
    if (!c) return;
    onScan?.(c, { source });
    setValue('');
    firstKeyTs.current = 0;
    keyCount.current = 0;
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Classify a wedge-scanner burst vs. human typing by average keystroke speed.
      const n = keyCount.current;
      const dur = firstKeyTs.current ? e.timeStamp - firstKeyTs.current : Infinity;
      const source = n >= 3 && dur / n < SCAN_MS_PER_CHAR ? 'scan' : 'manual';
      submit(value, source);
      return;
    }
    if (e.key.length === 1) {
      if (keyCount.current === 0) firstKeyTs.current = e.timeStamp;
      keyCount.current += 1;
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="material-symbols-outlined text-stone-400">barcode_scanner</span>
      <input
        ref={ref}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          // Text input: accepts ANY characters (letters, digits, '.', '-', '_'),
          // so an alphanumeric label code like "6a46...892de.1071f9..." pastes
          // and types verbatim. onValueChange lifts the live value so a PASTE
          // (no Enter) still arms the caller — while onScan still fires on Enter
          // / a completed scan, keeping wedge-scanner behaviour unchanged.
          setValue(e.target.value);
          onValueChange?.(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // Keep the scan field armed for keyboard-wedge scanners, but DON'T
          // steal focus when the user intentionally moves to another control
          // (input/select/button/etc.) — otherwise they can't type elsewhere.
          if (!autoFocus || showCamera) return;
          const to = e.relatedTarget;
          if (to && to.matches?.('input, textarea, select, button, a, [contenteditable="true"]')) return;
          ref.current?.focus();
        }}
        placeholder={placeholder}
        className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm font-mono focus:border-[#EA2831] focus:ring-1 focus:ring-[#EA2831] outline-none"
        autoComplete="off"
      />
      {showAdd && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => submit(value, 'manual')}
          title="Add serial number"
          className="px-3 py-2 rounded-lg border border-stone-200 text-stone-600 text-sm font-bold hover:text-[#EA2831] hover:border-[#EA2831] transition-colors"
        >
          Add
        </button>
      )}
      {camera && cameraScanSupported() && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowCamera(true)}
          title="Scan with device camera"
          className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:text-[#EA2831] hover:border-[#EA2831] transition-colors"
        >
          <span className="material-symbols-outlined text-xl">photo_camera</span>
        </button>
      )}
      {showCamera && (
        <CameraScanner
          onClose={() => setShowCamera(false)}
          onDetected={(code) => { setShowCamera(false); submit(code, 'scan'); }}
        />
      )}
    </div>
  );
};

export default ScanBox;
