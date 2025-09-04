import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptions');

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>() as any;
    const res = ctx.getResponse<Response>() as any;

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // 에러 본문
    const responseBody = isHttp
      ? (exception.getResponse?.() ?? exception.message)
      : { message: exception?.message ?? 'Internal server error' };

    // ✅ 요청/응답/스택 모두 로그
    this.logger.error(
      [
        `[${req.method}] ${req.url}`,
        `status=${status}`,
        `user=${JSON.stringify(req.user ?? null)}`,
        `query=${JSON.stringify(req.query ?? {})}`,
        `body=${safeJSON(req.body)}`,
        `headers.x-orig-method=${req.headers?.['x-orig-method'] ?? ''}`,
        `error=${exception?.message ?? exception}`,
        exception?.stack ? `stack=\n${exception.stack}` : '',
      ].join(' | ')
    );

    // 클라이언트 응답
    res.status(status).json(
      typeof responseBody === 'object'
        ? responseBody
        : { statusCode: status, message: String(responseBody) },
    );
  }
}

function safeJSON(v: any) {
  try { return JSON.stringify(v ?? {}); } catch { return '[unserializable]'; }
}