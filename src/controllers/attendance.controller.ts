import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { attendanceService } from '../services/attendance.service.js';
import { UnauthorizedError } from '../lib/errors.js';

const coordsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
});

const checkinSchema = z.object({
  shift_id: z.string().uuid('shift_id phải là UUID hợp lệ'),
  segment_id: z.string().uuid('segment_id phải là UUID hợp lệ').optional(),
  coords: coordsSchema,
  face_descriptor: z
    .array(z.number().finite())
    .length(128, 'face_descriptor phải gồm đúng 128 số thực hữu hạn'),
});

const checkoutSchema = checkinSchema;

const enrollFaceSchema = z.object({
  descriptor: z
    .array(z.number().finite())
    .length(128, 'descriptor phải gồm đúng 128 số thực hữu hạn'),
  consent: z.boolean().refine((val) => val === true, {
    message: 'Bắt buộc đồng ý cam kết thu thập dữ liệu sinh trắc học theo quy định',
  }),
});

const listAttendancesQuerySchema = z.object({
  user_id: z.string().uuid().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from_date định dạng YYYY-MM-DD').optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to_date định dạng YYYY-MM-DD').optional(),
  status: z.enum(['present', 'late', 'early_leave', 'absent', 'pending']).optional(),
  flagged: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const attendanceController = {
  async checkin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const body = checkinSchema.parse(req.body);
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
      const userAgent = req.headers['user-agent'];

      const result = await attendanceService.checkin({
        userId: req.user.id,
        storeId: req.user.storeId,
        shiftId: body.shift_id,
        segmentId: body.segment_id,
        coords: body.coords,
        faceDescriptor: body.face_descriptor,
        ip,
        userAgent,
      });

      res.status(201).json({
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async checkout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const body = checkoutSchema.parse(req.body);
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
      const userAgent = req.headers['user-agent'];

      const result = await attendanceService.checkout({
        userId: req.user.id,
        storeId: req.user.storeId,
        shiftId: body.shift_id,
        segmentId: body.segment_id,
        coords: body.coords,
        faceDescriptor: body.face_descriptor,
        ip,
        userAgent,
      });

      res.status(200).json({
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const queryParams = listAttendancesQuerySchema.parse(req.query);

      // RBAC: Staff chỉ được xem của chính mình, Admin có thể lọc theo user_id
      const targetUserId = req.user.role === 'admin' ? queryParams.user_id : req.user.id;

      const records = await attendanceService.listAttendances({
        storeId: req.user.storeId,
        userId: targetUserId,
        fromDate: queryParams.from_date,
        toDate: queryParams.to_date,
        status: queryParams.status,
        flagged: queryParams.flagged,
      });

      res.status(200).json({
        data: records,
      });
    } catch (err) {
      next(err);
    }
  },

  async enrollFace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const body = enrollFaceSchema.parse(req.body);

      const result = await attendanceService.enrollFace(
        req.user.id,
        req.user.storeId,
        body.descriptor,
        body.consent,
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getFaceStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();
      const result = await attendanceService.getFaceStatus(req.user.id);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async resetFace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = z.string().uuid().parse(req.params['userId']);
      const result = await attendanceService.resetFace(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteFace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = z.string().uuid().parse(req.params['userId']);
      const result = await attendanceService.deleteFace(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};
