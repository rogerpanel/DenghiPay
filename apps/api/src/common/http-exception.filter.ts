import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError } from '@morapay/domain';
import { LedgerError } from '@morapay/ledger';
import { ScrubbingLogger, scrub } from './logger';

/**
 * One error shape for the whole API.
 *
 * Domain and ledger errors carry a machine-readable code, so a client can act
 * on `QUOTE_EXPIRED` without string-matching a sentence. Anything unrecognised
 * becomes a 500 with a correlation id and no internals — a stack trace in a
 * response body is an information leak, not a convenience.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: ScrubbingLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = (request.headers['x-correlation-id'] as string | undefined) ?? undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { code: httpCodeFor(status), message: body, correlationId }
            : { ...(body as object), correlationId },
        );
      return;
    }

    if (exception instanceof DomainError || exception instanceof LedgerError) {
      // A domain rule said no. That is a client-visible outcome, not a fault.
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        code: exception.code,
        message: exception.message,
        correlationId,
      });
      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.path}`,
      exception instanceof Error ? exception.stack : scrub(exception),
      'AllExceptionsFilter',
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. The incident has been recorded.',
      correlationId,
    });
  }
}

function httpCodeFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return 'ERROR';
  }
}
