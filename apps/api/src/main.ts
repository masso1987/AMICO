import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadEnv } from './config/env';

async function main() {
  const env = loadEnv(); // fails fast on bad configuration
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(env.PORT);
  Logger.log(`AMICO API on :${env.PORT} (${env.NODE_ENV}${env.SIMULATION_MODE ? ', SIMULATION MODE' : ''}) — docs at /docs`, 'Bootstrap');
}

void main();
