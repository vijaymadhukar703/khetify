import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

/**
 * Renders `value` as a Code 128 barcode SVG via JsBarcode. Code 128 is far
 * denser than the legacy Code 39 renderer (lib/barcode.jsx), which matters for
 * long unit serials like ABSAMIO012-001.
 */
const Barcode128 = ({ value = '', height = 36, displayValue = false, width = 1.4, className = '' }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, String(value), {
        format: 'CODE128',
        height,
        width,
        displayValue,
        margin: 0,
        background: 'transparent',
      });
    } catch {
      /* invalid value — leave blank */
    }
  }, [value, height, width, displayValue]);

  return <svg ref={ref} className={className} role="img" aria-label={`barcode ${value}`} />;
};

export default Barcode128;
