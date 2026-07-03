import React from 'react';

// Shared admin bits — status pill + date formatter, matched to the app palette.
const STATUS_STYLE = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
};
const STATUS_DOT = {
  pending: 'bg-amber-500',
  approved: 'bg-green-500',
  rejected: 'bg-red-500',
};

export const StatusBadge = ({ status }) => {
  const s = (status || 'pending').toLowerCase();
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[s] || STATUS_STYLE.pending}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s] || STATUS_DOT.pending}`} />
      {label}
    </span>
  );
};

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
