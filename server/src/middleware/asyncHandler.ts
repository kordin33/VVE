// 4.8: asyncHandler wraps async route handlers to forward errors to Express error handler
import { Request, Response, NextFunction, RequestHandler } from 'express';

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};
