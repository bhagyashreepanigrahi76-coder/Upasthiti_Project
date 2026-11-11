export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine formula). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The geofence whose edge is closest, and how far the point is from its centre. */
export function nearestGeofence<T extends LatLng & { radiusMeters: number }>(
  fences: T[],
  point: LatLng,
): { fence: T; distance: number } | null {
  let best: { fence: T; distance: number } | null = null;
  for (const fence of fences) {
    const distance = distanceMeters(fence, point);
    if (!best || distance - fence.radiusMeters < best.distance - best.fence.radiusMeters) {
      best = { fence, distance };
    }
  }
  return best;
}
