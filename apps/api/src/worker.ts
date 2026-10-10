import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

/**
 * Standalone worker process for staging/production: runs the BullMQ processors
 * (collections, payouts, status checks, refunds) without serving HTTP.
 * Run the API with RUN_WORKERS=false and this process with RUN_WORKERS=true.
 */
async function main() {
  const env = loadEnv();
  if (!env.RUN_WORKERS || !env.USE_QUEUE) throw new Error('Worker needs RUN_WORKERS=true and USE_QUEUE=true');
  const ctx = await NestFactory.createApplicationContext(AppModule);
  ctx.enableShutdownHooks();
  Logger.log('AMICO worker started', 'Worker');
}

void main();
