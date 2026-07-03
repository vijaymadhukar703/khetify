import React from 'react';

// Code 39 — each character is 9 elements (bar/space, alternating, starting with
// a bar). 'n' = narrow (1 module), 'w' = wide (3 modules). Fully local + scannable.
const CODE39 = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
  'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn',
  'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
  'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
  'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

/**
 * Render `value` as a Code 39 barcode SVG (no external dependency).
 * Unsupported characters are dropped; the value is wrapped in * start/stop guards.
 */
const Barcode = ({ value = '', height = 56, narrow = 2, className = '' }) => {
  const text = String(value).toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '');
  const chars = `*${text}*`.split('');

  const bars = [];
  let x = 0;
  const wide = narrow * 3;
  for (const ch of chars) {
    const pattern = CODE39[ch];
    if (!pattern) continue;
    for (let i = 0; i < pattern.length; i++) {
      const w = pattern[i] === 'w' ? wide : narrow;
      const isBar = i % 2 === 0; // elements 0,2,4,6,8 are bars
      if (isBar) bars.push(<rect key={`${x}-${ch}-${i}`} x={x} y={0} width={w} height={height} fill="#1c1917" />);
      x += w;
    }
    x += narrow; // inter-character gap
  }

  return (
    <svg width="100%" viewBox={`0 0 ${x} ${height}`} preserveAspectRatio="none" className={className} role="img" aria-label={`barcode ${text}`}>
      {bars}
    </svg>
  );
};

export default Barcode;
