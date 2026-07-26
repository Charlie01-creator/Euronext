import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { ApiError } from '../utils/ApiError';

/** Validates req.body / req.query / req.params against a Zod schema, replacing them with the parsed (typed, coerced) values. */
export const validate =
  (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      req.body = parsed.body ?? req.body;
      req.query = parsed.query ?? req.query;
      req.params = parsed.params ?? req.params;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(ApiError.badRequest('Validation failed', err.flatten().fieldErrors));
      }
      next(err);
    }
  };
