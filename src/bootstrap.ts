import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ProblemDetailsFilter } from './common/http/problem-details.filter';
import { requestIdMiddleware } from './common/http/request-id.middleware';
import { createValidationPipe } from './common/http/validation';

/**
 * Cross-cutting HTTP setup shared by `main.ts` and the e2e suite, so tests
 * exercise exactly the pipeline that runs in production.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Pulso Orders API')
      .setDescription(
        'Orders for the Pulso on-demand microtask marketplace. Errors use application/problem+json (RFC 9457).',
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });

  return app;
}
