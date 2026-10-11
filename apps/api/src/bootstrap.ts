import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadEnv } from './config/env';

/** Shared HTTP setup for main.ts and e2e tests. */
export function configureApp(app: INestApplication): void {
  const env = loadEnv();
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  // The web apps (on loopback) forward Nginx's X-Forwarded-For; req.ip becomes the visitor's address.
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  app.enableCors({ origin: env.NODE_ENV === 'production' ? false : true, credentials: false });

  const doc = new DocumentBuilder()
    .setTitle('AMICO Cameroon API')
    .setDescription(
      'Authoritative API for the AMICO mobile money and airtime exchange platform (AMICO Cameroon — Alpha Multi-Integrated Corporation). ' +
        (env.SIMULATION_MODE ? 'SIMULATION MODE: no real money or airtime moves.' : ''),
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
}
