// Shared UI bits for the IMS pages — styled to match the rest of the app
// (font-sora, stone palette, #EA2831 accents, rounded-xl cards, tiny uppercase labels).
import React, { useState, useRef, useEffect } from 'react';

export const StatCard = ({ label, value, accent }) => (
  <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm">
    <p className="text-stone-500 text-[10px] font-bold uppercase mb-2 tracking-wider">{label}</p>
    <p className={`text-2xl sm:text-3xl font-bold ${accent || 'text-stone-900'}`}>{value}</p>
  </div>
);

export const Modal = ({ title, onClose, children, wide }) => (
  <div
    className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 font-sora"
    onClick={(e) => e.target === e.currentTarget && onClose()}
  >
    <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[88vh] overflow-y-auto p-6`}>
      <div className="flex items-start justify-between mb-5">
        <h3 className="text-lg font-bold text-stone-900">{title}</h3>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      {children}
    </div>
  </div>
);

export const Field = ({ label, required, children }) => {
  // Render a trailing "*" (or an explicit `required` prop) as a red asterisk.
  const base = typeof label === 'string' ? label.replace(/\s*\*\s*$/, '') : label;
  const showStar = required || (typeof label === 'string' && /\*\s*$/.test(label));
  return (
    <div className="flex flex-col gap-1.5 mb-4">
      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
        {base}{showStar && <span className="text-[#EA2831] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
};

export const inputCls =
  'w-full border border-stone-200 rounded-lg px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30 focus:border-[#EA2831]';

// Searchable single-select — a drop-in replacement for a long native <select>.
// Type to filter, scroll the results, click to pick. Styled to match inputCls.
//   options: [{ value, label }]
//   value:   currently-selected value; onChange(value) fires on pick.
export const SearchSelect = ({ value, onChange, options = [], placeholder = 'Select…', disabled }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;

  // Close the dropdown when clicking anywhere outside the widget.
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  const pick = (o) => { onChange(o.value); setOpen(false); setQuery(''); };

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        disabled={disabled}
        className={`${inputCls} pr-9 disabled:bg-stone-50 disabled:cursor-not-allowed`}
        // While open the field shows what you're typing; when closed it shows the
        // chosen label. Focus clears it for typing but keeps the pick as placeholder.
        value={open ? query : (selected?.label || '')}
        placeholder={open && selected ? selected.label : placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
      />
      <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-[20px] pointer-events-none">
        {open ? 'search' : 'expand_more'}
      </span>
      {open && (
        <ul className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-stone-200 rounded-lg shadow-lg py-1">
          {filtered.length === 0 && (
            <li className="px-3.5 py-2 text-sm text-stone-400">No matches</li>
          )}
          {filtered.map((o) => (
            <li
              key={o.value}
              // onMouseDown (not onClick) so the pick registers before the input blur.
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              className={`px-3.5 py-2 text-sm cursor-pointer hover:bg-stone-100 ${
                o.value === value ? 'bg-[#EA2831]/10 text-[#EA2831] font-semibold' : 'text-stone-700'
              }`}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const PrimaryBtn = ({ children, ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center gap-2 bg-[#EA2831] hover:bg-[#c91e26] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg px-5 py-2.5 transition-colors ${props.className || ''}`}
  >
    {children}
  </button>
);

export const GhostBtn = ({ children, sm, ...props }) => (
  <button
    {...props}
    // `sm` → tighter padding/text for dense action columns.
    className={`inline-flex items-center gap-1.5 border border-stone-200 hover:bg-stone-50 text-stone-700 font-bold rounded-lg transition-colors ${sm ? 'text-[11px] px-2 py-1' : 'text-xs px-3 py-2'} ${props.className || ''}`}
  >
    {children}
  </button>
);

export const Th = ({ children, right, compact }) => (
  <th className={`${compact ? 'px-3 py-3' : 'px-6 py-4'} text-[10px] font-bold text-stone-400 uppercase tracking-widest ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
);
