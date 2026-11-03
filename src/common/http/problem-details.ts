import { STATUS_CODES } from 'node:http';
import { HttpException } from '@nestjs/common';
import { DomainError, InvalidTransitionError } from '../domain-errors';

export const PROBLEM_TYPE_BASE = 'https://docs.pulso.example/problems/';
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** RFC 9457 problem document plus a few well-known extension members. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  [extension: string]: unknown;
}

export interface FieldError {
  field: string;
  messages: string[];
}

/** Thrown by the global ValidationPipe so the filter can render field errors. */
export class RequestValidationError extends Error {
  constructor(readonly errors: FieldError[]) {
    super('The request is invalid');
  }
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function fromStatus(status: number, detail?: string): ProblemDetails {
  const title = STATUS_CODES[status] ?? 'Error';
  return { type: PROBLEM_TYPE_BASE + slug(title), title, status, ...(detail ? { detail } : {}) };
}

/** Express/body-parser errors carry `status` and `expose` for client-safe 4xx failures. */
function isExposedClientError(error: unknown): error is Error & { status: number; type?: string } {
  if (!(error instanceof Error)) return false;
  const { status, expose } = error as Error & { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}

export function toProblem(error: unknown): ProblemDetails {
  if (error instanceof RequestValidationError) {
    return {
      type: PROBLEM_TYPE_BASE + 'validation-failed',
      title: 'Request validation failed',
      status: 400,
      detail: error.message,
      errors: error.errors,
    };
  }

  if (error instanceof DomainError) {
    const problem: ProblemDetails = {
      type: PROBLEM_TYPE_BASE + error.code,
      title: error.title,
      status: error.status,
      detail: error.message,
    };
    if (error instanceof InvalidTransitionError) {
      Object.assign(problem, { from: error.from, to: error.to, allowed: error.allowed });
    }
    return problem;
  }

  if (error instanceof HttpException) {
    const response = error.getResponse();
    const message = typeof response === 'string' ? response : (response as { message?: unknown }).message;
    return fromStatus(error.getStatus(), typeof message === 'string' ? message : error.message);
  }

  if (isExposedClientError(error)) {
    if (error.type === 'entity.parse.failed') {
      return { ...fromStatus(400, 'Request body is not valid JSON'), type: PROBLEM_TYPE_BASE + 'malformed-json' };
    }
    return fromStatus(error.status, error.message);
  }

  return fromStatus(500, 'An unexpected error occurred');
}
