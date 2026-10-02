import { describe, it, expect } from 'vitest';
import { calculateHaversineDistance, isWithinStoreRadius } from './distance.js';

describe('Haversine Distance & Radius Check', () => {
  // Toạ độ mẫu quán demo tại TP.HCM
  const store = { lat: 10.7769, lng: 106.7009 };
  const radiusM = 50;

  it('1. Trùng toạ độ chính xác quán -> khoảng cách = 0m, isWithin = true', () => {
    const res = isWithinStoreRadius(store, store, radiusM);
    expect(res.distanceM).toBe(0);
    expect(res.isWithin).toBe(true);
  });

  it('2. Vị trí cách quán 49m (biên trong) -> isWithin = true', () => {
    // 49m về hướng Bắc (thay đổi vĩ độ lat)
    // 1m lat ≈ 1 / 111139 rad/deg ≈ 0.0000089975°
    const offset49m = 49 / 111139;
    const userPoint = { lat: store.lat + offset49m, lng: store.lng };
    const res = isWithinStoreRadius(userPoint, store, radiusM);

    expect(res.distanceM).toBeCloseTo(49, 0);
    expect(res.distanceM).toBeLessThanOrEqual(50);
    expect(res.isWithin).toBe(true);
  });

  it('3. Vị trí cách quán 51m (biên ngoài) -> isWithin = false', () => {
    const offset51m = 51 / 111139;
    const userPoint = { lat: store.lat + offset51m, lng: store.lng };
    const res = isWithinStoreRadius(userPoint, store, radiusM);

    expect(res.distanceM).toBeCloseTo(51, 0);
    expect(res.distanceM).toBeGreaterThan(50);
    expect(res.isWithin).toBe(false);
  });

  it('4. Khoảng cách đối xứng: d(A, B) == d(B, A)', () => {
    const pointA = { lat: 10.7769, lng: 106.7009 };
    const pointB = { lat: 10.7800, lng: 106.7050 };
    const d1 = calculateHaversineDistance(pointA, pointB);
    const d2 = calculateHaversineDistance(pointB, pointA);
    expect(d1).toBe(d2);
  });

  it('5. Vị trí ở xa (1km) -> isWithin = false', () => {
    const farPoint = { lat: store.lat + 0.01, lng: store.lng + 0.01 };
    const res = isWithinStoreRadius(farPoint, store, radiusM);
    expect(res.distanceM).toBeGreaterThan(1000);
    expect(res.isWithin).toBe(false);
  });
});
