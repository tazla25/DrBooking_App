/**
 * Runs BEFORE any test module is imported (setupFiles). Points Prisma at the
 * dedicated test database so the dev DB is never touched. Explicit assignment
 * overrides any ambient DATABASE_URL exported by the host environment.
 */
const path = require('path');

// connection_limit=1: SQLite allows a single writer; Prisma's default pooled
// connections thrash file locks under parallel route-handler tests
// (interactive transactions stall into P1008/P2028 timeouts). One connection
// serializes every query cleanly — Phase 3's 10-parallel-booking test runs
// in well under a second this way.
process.env.DATABASE_URL =
  'file:' + path.join(__dirname, '..', 'db', 'test.db') + '?connection_limit=1';
process.env.DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || '91';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
