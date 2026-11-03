import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { type FieldError, RequestValidationError } from './problem-details';

/** Flattens nested class-validator errors into dotted paths such as `items.0.qty`. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => new RequestValidationError(flattenValidationErrors(errors)),
  });
}
