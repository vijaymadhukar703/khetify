import React from 'react';
import { useNavigate } from 'react-router-dom';

// Shared "go back" control used across the Administration leaf pages. Defaults to
// browser-history back; pass `to` to force a fixed destination instead.
const BackButton = ({ to, label = 'Back', className = '' }) => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => (to ? navigate(to) : navigate(-1))}
      className={`inline-flex items-center gap-1.5 text-sm font-semibold text-stone-600 hover:text-[#EA2831] transition-colors mb-6 ${className}`}
    >
      <span className="material-symbols-outlined text-[20px]">arrow_back</span>
      {label}
    </button>
  );
};

export default BackButton;
