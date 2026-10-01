import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { env } from '../config/env.js';

const loginSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(1, 'Mật khẩu không được để trống'),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mật khẩu hiện tại không được để trống'),
    newPassword: z
      .string()
      .min(8, 'Mật khẩu mới phải ít nhất 8 ký tự')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Mật khẩu phải có chữ hoa, chữ thường và số',
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  });

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

const REFRESH_COOKIE_NAME = 'refresh_token';
const ACCESS_COOKIE_NAME = 'access_token';

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; expiresIn: string },
): void {
  res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE_NAME, cookieOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, { ...cookieOptions, path: '/api/auth' });
}

export const authController = {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = loginSchema.parse(req.body);
      const { user, tokens } = await authService.login(
        body.email,
        body.password,
        env.DEFAULT_STORE_ID,
      );

      setAuthCookies(res, tokens);

      res.json({
        user,
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
      });
    } catch (err) {
      next(err);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken =
        (req.cookies[REFRESH_COOKIE_NAME] as string | undefined) ??
        (req.body as { refreshToken?: string }).refreshToken;

      if (!rawToken) {
        res.status(401).json({
          code: 'UNAUTHORIZED',
          message: 'Refresh token không tìm thấy',
        });
        return;
      }

      const tokens = await authService.refresh(rawToken);
      setAuthCookies(res, tokens);

      res.json({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
    } catch (err) {
      next(err);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.cookies[REFRESH_COOKIE_NAME] as string | undefined;
      if (rawToken) {
        await authService.logout(rawToken);
      }
      clearAuthCookies(res);
      res.json({ message: 'Đăng xuất thành công' });
    } catch (err) {
      next(err);
    }
  },

  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = changePasswordSchema.parse(req.body);
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: 'Chưa đăng nhập' });
        return;
      }

      await authService.changePassword(userId, body.currentPassword, body.newPassword);

      clearAuthCookies(res);
      res.json({ message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' });
    } catch (err) {
      next(err);
    }
  },

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ user: req.user });
    } catch (err) {
      next(err);
    }
  },
};
