/**
 * Runs BEFORE any test module is imported (setupFiles). Points Prisma at the
 * dedicated test database so the dev DB is never touched. Explicit assignment
 * overrides any ambient DATABASE_URL exported by the host environment.
 */
const path = require('path');

process.env.DATABASE_URL = 'file:' + path.join(__dirname, '..', 'db', 'test.db');
process.env.DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || '91';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
