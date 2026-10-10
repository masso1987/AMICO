// Loaded before every e2e test file (jest setupFiles): isolated DB, inline jobs, simulation on.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://amico:amico_dev@localhost:5432/amico_test?schema=public';
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.JWT_SECRET = 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.SIMULATION_MODE = 'true';
process.env.USE_QUEUE = 'false';
process.env.RUN_WORKERS = 'false';
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), 'amico-test-uploads');
process.env.CALLBACK_SHARED_SECRET = 'test-callback-secret-0123456789';
