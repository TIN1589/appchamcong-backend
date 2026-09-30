/**
 * Unit tests: Euclidean distance / face verification [A7]
 */
import { describe, it, expect } from 'vitest';

// Test pure logic — không cần mock DB
// usersService.verifyFace gọi internal Euclidean distance
// Tách logic ra hàm testable

function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Length mismatch');
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// Threshold 0.6 theo face-api.js docs
const THRESHOLD = 0.6;

function isSamePerson(stored: number[], incoming: number[]): boolean {
  return euclideanDistance(stored, incoming) < THRESHOLD;
}

// Tạo descriptor giả 128-d
function zeros(): number[] { return Array(128).fill(0) as number[]; }
function ones(): number[] { return Array(128).fill(1) as number[]; }
function similar(base: number[], noise: number): number[] {
  return base.map((v) => v + (Math.random() - 0.5) * noise);
}

describe('euclideanDistance', () => {
  it('same descriptor = distance 0', () => {
    const desc = zeros();
    expect(euclideanDistance(desc, desc)).toBe(0);
  });

  it('distance between zeros and ones', () => {
    // sqrt(128 * 1^2) = sqrt(128) ≈ 11.31
    const d = euclideanDistance(zeros(), ones());
    expect(d).toBeCloseTo(Math.sqrt(128), 5);
  });

  it('symmetric: d(a,b) == d(b,a)', () => {
    const a = similar(zeros(), 0.5);
    const b = similar(zeros(), 0.5);
    expect(euclideanDistance(a, b)).toBeCloseTo(euclideanDistance(b, a), 10);
  });

  it('throws on length mismatch', () => {
    expect(() => euclideanDistance([1, 2, 3], [1, 2])).toThrow('Length mismatch');
  });
});

describe('face verification (Euclidean ≤ 0.6 = match)', () => {
  it('identical descriptors = match', () => {
    const desc = similar(zeros(), 0.2);
    expect(isSamePerson(desc, desc)).toBe(true);
  });

  it('very similar descriptors (noise=0.05) = match', () => {
    const base = similar(zeros(), 0.3);
    const incoming = base.map((v) => v + (Math.random() - 0.5) * 0.05);
    // Distance sẽ rất nhỏ
    expect(euclideanDistance(base, incoming)).toBeLessThan(THRESHOLD);
    expect(isSamePerson(base, incoming)).toBe(true);
  });

  it('completely different descriptors = no match', () => {
    const storedPerson = similar(zeros(), 0.3);
    const differentPerson = similar(ones(), 0.3);
    // Distance ≈ sqrt(128) ≈ 11.31 → no match
    expect(euclideanDistance(storedPerson, differentPerson)).toBeGreaterThan(THRESHOLD);
    expect(isSamePerson(storedPerson, differentPerson)).toBe(false);
  });

  it('threshold boundary: distance > 0.6 = no match', () => {
    const stored = zeros();
    // Construct incoming such that distance is clearly above 0.6
    // d = sqrt(128 * x^2) > 0.6 → x > 0.6 / sqrt(128) ≈ 0.053
    // Use x = 0.0531 to ensure distance > 0.6 regardless of float precision
    const x = 0.0531;
    const incoming = stored.map((v) => v + x);
    const d = euclideanDistance(stored, incoming);
    // d = sqrt(128 * 0.0531^2) = 0.0531 * 11.314 ≈ 0.6008 > 0.6
    expect(d).toBeGreaterThan(0.6);
    expect(isSamePerson(stored, incoming)).toBe(false);
  });

  it('threshold boundary: distance 0.599 = match', () => {
    const stored = zeros();
    const x = 0.599 / Math.sqrt(128);
    const incoming = stored.map((v) => v + x);
    const d = euclideanDistance(stored, incoming);
    expect(d).toBeLessThan(0.6);
    expect(isSamePerson(stored, incoming)).toBe(true);
  });
});
