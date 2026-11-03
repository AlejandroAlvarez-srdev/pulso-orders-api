/**
 * Errors raised by the domain and application layers. They carry enough
 * information for the HTTP layer to render an RFC 9457 problem document
 * without the domain knowing anything about HTTP.
 */
export abstract class DomainError extends Error {
  abstract readonly status: number;
  /** Stable, URL-safe identifier appended to the problem `type` URI. */
  abstract readonly code: string;
  abstract readonly title: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly status = 404;
  readonly code = 'not-found';
  readonly title = 'Resource not found';
}

export class InvalidTransitionError extends DomainError {
  readonly status = 409;
  readonly code = 'invalid-transition';
  readonly title = 'Invalid order status transition';

  constructor(
    readonly from: string,
    readonly to: string,
    readonly allowed: readonly string[],
  ) {
    super(
      `Cannot transition order from ${from} to ${to}. Allowed: ${allowed.length ? allowed.join(', ') : 'none (terminal status)'}`,
    );
  }
}

export class ConcurrentModificationError extends DomainError {
  readonly status = 409;
  readonly code = 'concurrent-modification';
  readonly title = 'Resource was modified concurrently';
}

export class IdempotencyKeyReusedError extends DomainError {
  readonly status = 422;
  readonly code = 'idempotency-key-reused';
  readonly title = 'Idempotency key reused with a different payload';
}

export class IdempotencyKeyInFlightError extends DomainError {
  readonly status = 409;
  readonly code = 'idempotency-key-in-flight';
  readonly title = 'A request with this idempotency key is still being processed';
}

export class InvalidCursorError extends DomainError {
  readonly status = 400;
  readonly code = 'invalid-cursor';
  readonly title = 'Invalid pagination cursor';
}

export class RateLimitedError extends DomainError {
  readonly status = 429;
  readonly code = 'rate-limited';
  readonly title = 'Too many requests';

  constructor(readonly retryAfterSeconds: number) {
    super(`Rate limit exceeded; retry in ${retryAfterSeconds}s`);
  }
}

export class PreconditionFailedError extends DomainError {
  readonly status = 412;
  readonly code = 'precondition-failed';
  readonly title = 'The resource changed since the given ETag';
}

export class PreconditionRequiredError extends DomainError {
  readonly status = 428;
  readonly code = 'precondition-required';
  readonly title = 'This request must be conditional (If-Match)';
}

export class OrderNotEditableError extends DomainError {
  readonly status = 409;
  readonly code = 'order-not-editable';
  readonly title = 'The order can no longer be edited';
}
