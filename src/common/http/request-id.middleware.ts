import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept caller-provided ids only if they are short and log-safe.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const logger = new Logger('HTTP');

/**
 * Assigns a correlation id to every request, echoes it back in the response
 * and emits one structured log line per request when the response finishes.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  req.id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.log({
      msg: 'request completed',
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      merchantId: req.principal?.merchantId,
    });
  });
  next();
}
