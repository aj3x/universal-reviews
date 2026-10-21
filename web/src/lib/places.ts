export function metersToString(meters?: number): string {
  if (meters === undefined) return "";
  if (meters < 100) return `${meters} m`;
  if (meters < 300) return `${Math.round(meters/10) * 10} m`;
  if (meters < 1000) return `${Math.round(meters/50) * 50} m`;
  if (meters < 100000) return `${(meters / 1000).toFixed(1)} km`;
  return `${(meters / 1000).toFixed(0)} km`;
}