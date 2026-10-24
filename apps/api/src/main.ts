import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig, corsOrigins } from './config/config';
import { ScrubbingLogger, createRootLogger } from './common/logger';
import { AllExceptionsFilter } from './common/http-exception.filter';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new ScrubbingLogger(
    createRootLogger(config.LOG_LEVEL, config.NODE_ENV !== 'production'),
  );

  const app = await NestFactory.create(AppModule, {
    logger,
    // Required by the callback endpoint: the signature covers the raw bytes,
    // before JSON parsing (TECHNICAL_ARCHITECTURE §4.1). A re-serialised body
    // would verify against nothing.
    rawBody: true,
  });

  app.use(
    helmet({
      contentSecurityPolicy: config.NODE_ENV === 'production',
      hsts: config.NODE_ENV === 'production',
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: corsOrigins(config),
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-correlation-id'],
    exposedHeaders: ['x-correlation-id'],
  });

  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.enableShutdownHooks();

  await app.listen(config.API_PORT, '0.0.0.0');

  logger.event('api.started', {
    port: config.API_PORT,
    environment: config.NODE_ENV,
    // The single most important fact about a running instance.
    liveFundsEnabled: config.LIVE_FUNDS_ENABLED,
    rateSource: config.RATE_SOURCE,
    kycProvider: config.KYC_PROVIDER,
    screeningProvider: config.SCREENING_PROVIDER,
  });

  if (config.LIVE_FUNDS_ENABLED) {
    logger.warn(
      'LIVE_FUNDS_ENABLED is true. Real money can move. Confirm the go-live gate is satisfied.',
      'bootstrap',
    );
  }
}

void bootstrap();
