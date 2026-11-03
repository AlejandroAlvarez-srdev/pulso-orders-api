import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { IdempotencyKeyReusedError, InvalidTransitionError } from '../domain-errors';
import { PROBLEM_TYPE_BASE, RequestValidationError, toProblem } from './problem-details';

describe('toProblem', () => {
  it('maps invalid transitions to 409 with allowed targets', () => {
    expect(toProblem(new InvalidTransitionError('DELIVERED', 'CANCELLED', []))).toMatchObject({
      type: PROBLEM_TYPE_BASE + 'invalid-transition',
      status: 409,
      from: 'DELIVERED',
      to: 'CANCELLED',
      allowed: [],
    });
  });

  it('maps other domain errors by their declared status', () => {
    expect(toProblem(new IdempotencyKeyReusedError('different body'))).toMatchObject({
      status: 422,
      type: PROBLEM_TYPE_BASE + 'idempotency-key-reused',
      detail: 'different body',
    });
  });

  it('keeps field errors from validation', () => {
    const errors = [{ field: 'items.0.qty', messages: ['qty must not be less than 1'] }];
    expect(toProblem(new RequestValidationError(errors))).toMatchObject({ status: 400, errors });
  });

  it('maps Nest HTTP exceptions using the standard reason phrase', () => {
    expect(toProblem(new UnauthorizedException('Missing bearer token'))).toEqual({
      type: PROBLEM_TYPE_BASE + 'unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Missing bearer token',
    });
    expect(toProblem(new NotFoundException()).type).toBe(PROBLEM_TYPE_BASE + 'not-found');
  });

  it('hides internals of unexpected errors', () => {
    const problem = toProblem(new Error('connection string postgres://secret'));

    expect(problem.status).toBe(500);
    expect(JSON.stringify(problem)).not.toContain('secret');
  });
});
