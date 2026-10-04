export interface Coordinates {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Tính khoảng cách đường chim bay giữa hai toạ độ địa lý theo công thức Haversine (đơn vị: mét).
 */
export function calculateHaversineDistance(point1: Coordinates, point2: Coordinates): number {
  const lat1Rad = toRadians(point1.lat);
  const lat2Rad = toRadians(point2.lat);
  const dLatRad = toRadians(point2.lat - point1.lat);
  const dLngRad = toRadians(point2.lng - point1.lng);

  const sinHalfLat = Math.sin(dLatRad / 2);
  const sinHalfLng = Math.sin(dLngRad / 2);

  const a =
    sinHalfLat * sinHalfLat +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinHalfLng * sinHalfLng;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_METERS * c * 100) / 100;
}

/**
 * Kiểm tra xem toạ độ người dùng có nằm trong bán kính cho phép của cửa hàng hay không.
 */
export function isWithinStoreRadius(
  userPoint: Coordinates,
  storePoint: Coordinates,
  radiusM: number,
): { isWithin: boolean; distanceM: number } {
  const distanceM = calculateHaversineDistance(userPoint, storePoint);
  return {
    isWithin: distanceM <= radiusM,
    distanceM,
  };
}
