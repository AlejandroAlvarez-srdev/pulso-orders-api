import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import { type Request, type Response } from 'express';
import { PROBLEM_CONTENT_TYPE, toProblem } from './problem-details';
import './request-context';

/** Renders every error, expected or not, as `application/problem+json`. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const problem = { ...toProblem(exception), instance: req.originalUrl, requestId: req.id };

    if (problem.status >= 500) {
      this.logger.error(
        { msg: 'unhandled error', requestId: req.id },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }
}
