export const FACE_DESCRIPTOR_LENGTH = 128;
export const FACE_MATCH_THRESHOLD = 0.6;

/**
 * Tính khoảng cách Euclidean giữa hai vector đặc trưng khuôn mặt (descriptor 128 chiều).
 */
export function calculateEuclideanDistance(a: number[], b: number[]): number {
  if (a.length !== FACE_DESCRIPTOR_LENGTH || b.length !== FACE_DESCRIPTOR_LENGTH) {
    throw new Error(
      `Độ dài descriptor không hợp lệ (cần ${FACE_DESCRIPTOR_LENGTH}, nhận ${a.length} và ${b.length})`,
    );
  }

  let sum = 0;
  for (let i = 0; i < FACE_DESCRIPTOR_LENGTH; i++) {
    const valA = a[i];
    const valB = b[i];
    if (valA === undefined || valB === undefined || !Number.isFinite(valA) || !Number.isFinite(valB)) {
      throw new Error('Vector khuôn mặt chứa giá trị không hợp lệ (NaN hoặc không hữu hạn)');
    }
    const diff = valA - valB;
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Xác minh khuôn mặt theo ngưỡng Euclidean <= threshold (mặc định 0.6).
 */
export function verifyFaceMatch(
  storedDescriptor: number[],
  incomingDescriptor: number[],
  threshold = FACE_MATCH_THRESHOLD,
): { isMatch: boolean; distance: number } {
  const distance = calculateEuclideanDistance(storedDescriptor, incomingDescriptor);
  return {
    isMatch: distance <= threshold,
    distance: Math.round(distance * 10000) / 10000,
  };
}
