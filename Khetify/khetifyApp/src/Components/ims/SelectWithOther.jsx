import React, { useState } from 'react';

const OTHER = '__other__';

/**
 * A native <select> with a built-in "Other…" escape hatch. When the user picks
 * Other, a text input appears and whatever they type becomes the field value.
 *
 * Fully controlled by `value`; `onChange` receives the resolved STRING value
 * (the picked option's value, or the free-text the user typed). It also handles
 * pre-existing custom values gracefully: if `value` isn't one of the known
 * options (e.g. a saved record with a custom category), the field opens in
 * Other-mode with that value pre-filled.
 *
 * Props:
 *   value        current string value (controlled)
 *   onChange     (value: string) => void
 *   options      array of strings OR { value, label } objects
 *   placeholder  optional empty-option label (omit to not render one)
 *   className    applied to both the select and the text input
 *   otherLabel   label for the Other option (default "Other…")
 *   otherPlaceholder  placeholder for the free-text input
 *   id, name, required, disabled  forwarded to the <select>
 */
export default function SelectWithOther({
  value = '',
  onChange,
  options = [],
  placeholder,
  className = '',
  otherLabel = 'Other…',
  otherPlaceholder = 'Type your own',
  id,
  name,
  required,
  disabled,
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const known = opts.some((o) => String(o.value) === String(value));
  // Other is active when explicitly chosen, or when the current value is a
  // non-empty custom string not present in the option list.
  const [forcedOther, setForcedOther] = useState(false);
  const isOther = forcedOther || (!!value && !known);

  const handleSelect = (e) => {
    const v = e.target.value;
    if (v === OTHER) {
      setForcedOther(true);
      onChange('');
    } else {
      setForcedOther(false);
      onChange(v);
    }
  };

  return (
    <>
      <select
        id={id}
        name={name}
        className={className}
        value={isOther ? OTHER : (value || '')}
        onChange={handleSelect}
        required={required}
        disabled={disabled}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
        <option value={OTHER}>{otherLabel}</option>
      </select>
      {isOther && (
        <input
          className={`${className} mt-2`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
          required={required}
          disabled={disabled}
          autoFocus
        />
      )}
    </>
  );
}
