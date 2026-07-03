/** Great-circle distance in metres between two [lat,lng] points (haversine). */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Is the reported device position within the warehouse geofence?
 * Warehouse.location.coordinates is [lng, lat] (GeoJSON). Returns
 * { ok, distance, radius }.
 */
function withinGeofence(warehouse, lat, lng) {
  const coords = warehouse?.location?.coordinates;
  const radius = warehouse?.geofenceRadiusM || 300;
  if (!coords || (coords[0] === 0 && coords[1] === 0)) {
    // No geofence configured for this warehouse — cannot enforce; treat as pass
    // but flag so the caller can record it.
    return { ok: true, distance: null, radius, unconfigured: true };
  }
  if (lat == null || lng == null) return { ok: false, distance: null, radius };
  const distance = distanceMeters(lat, lng, coords[1], coords[0]);
  return { ok: distance <= radius, distance: Math.round(distance), radius };
}

module.exports = { distanceMeters, withinGeofence };
