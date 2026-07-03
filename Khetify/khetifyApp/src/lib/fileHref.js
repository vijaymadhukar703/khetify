import config from '../../config/config';

// The backend serves files either as absolute (signed S3) URLs or as relative
// `/uploads/…` paths (local driver). Relative paths must be resolved against the
// API origin (BASE_URL without its trailing `/api/`), never hardcoded to
// localhost. Absolute URLs (S3 presigned) are returned untouched.
const ORIGIN = (config.BASE_URL || '').replace(/\/api\/?$/, '');

export const fileHref = (url) => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
};
