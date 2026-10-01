import bcrypt from 'bcrypt';
import { usersRepository } from '../repositories/users.repository.js';
import { ConflictError, NotFoundError, AppError, ErrorCode } from '../lib/errors.js';
import type { SafeUser, UserRole, PaginatedResult, PaginationParams } from '../types/db.js';

const BCRYPT_ROUNDS = 12;

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Mật khẩu phải ít nhất 8 ký tự', 400);
  }
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Mật khẩu phải có chữ hoa, chữ thường và số',
      400,
    );
  }
}

export const usersService = {
  async list(
    storeId: number,
    pagination: PaginationParams,
    filters?: { role?: UserRole; isActive?: boolean },
  ): Promise<PaginatedResult<SafeUser>> {
    return usersRepository.findAll(storeId, pagination, filters);
  },

  async getById(userId: string, storeId: number): Promise<SafeUser> {
    const user = await usersRepository.findById(userId, storeId);
    if (!user) throw new NotFoundError('Nhân viên');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, face_descriptor, ...safe } = user;
    return safe;
  },

  async create(
    storeId: number,
    data: {
      email: string;
      initialPassword: string;
      role: UserRole;
      fullName: string;
      phone?: string;
      hourlyRate?: number;
      leaveBalance?: number;
    },
  ): Promise<SafeUser> {
    const exists = await usersRepository.emailExists(data.email, storeId);
    if (exists) {
      throw new ConflictError(ErrorCode.EMAIL_ALREADY_EXISTS, 'Email đã tồn tại trong hệ thống');
    }

    validatePassword(data.initialPassword);
    const passwordHash = await bcrypt.hash(data.initialPassword, BCRYPT_ROUNDS);

    return usersRepository.create({
      storeId,
      email: data.email,
      passwordHash,
      role: data.role,
      fullName: data.fullName,
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.hourlyRate !== undefined ? { hourlyRate: data.hourlyRate } : {}),
      ...(data.leaveBalance !== undefined ? { leaveBalance: data.leaveBalance } : {}),
    });
  },

  async update(
    userId: string,
    storeId: number,
    data: Partial<{
      fullName: string;
      phone: string | null;
      hourlyRate: number;
      leaveBalance: number;
      isActive: boolean;
    }>,
  ): Promise<SafeUser> {
    const updated = await usersRepository.update(userId, storeId, data);
    if (!updated) throw new NotFoundError('Nhân viên');
    return updated;
  },

  async enrollFace(
    userId: string,
    storeId: number,
    descriptor: number[],
  ): Promise<void> {
    if (!Array.isArray(descriptor) || descriptor.length !== 128) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Face descriptor phải là array 128 phần tử',
        400,
      );
    }
    if (!descriptor.every((v) => typeof v === 'number' && isFinite(v))) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Face descriptor chứa giá trị không hợp lệ', 400);
    }

    const user = await usersRepository.findById(userId, storeId);
    if (!user) throw new NotFoundError('Nhân viên');

    await usersRepository.saveFaceDescriptor(userId, storeId, descriptor);
  },

  async verifyFace(
    userId: string,
    storeId: number,
    incomingDescriptor: number[],
  ): Promise<{ match: boolean; distance: number }> {
    if (!Array.isArray(incomingDescriptor) || incomingDescriptor.length !== 128) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Face descriptor không hợp lệ', 400);
    }

    const storedDescriptor = await usersRepository.getFaceDescriptor(userId, storeId);
    if (!storedDescriptor) {
      throw new AppError(
        ErrorCode.ATTENDANCE_NO_DESCRIPTOR,
        'Nhân viên chưa đăng ký khuôn mặt',
        400,
      );
    }

    let sum = 0;
    for (let i = 0; i < 128; i++) {
      const a = storedDescriptor[i] ?? 0;
      const b = incomingDescriptor[i] ?? 0;
      sum += (a - b) ** 2;
    }
    const distance = Math.sqrt(sum);

    const THRESHOLD = 0.6;
    return { match: distance < THRESHOLD, distance };
  },
};
