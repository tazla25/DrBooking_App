/**
 * Jest global setup: recreate the test database (SQLite) with the current
 * Prisma schema before the suite runs.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
const TEST_DB = path.join(API_DIR, 'db', 'test.db');
const DATABASE_URL = 'file:' + TEST_DB;

module.exports = async function globalSetup() {
  fs.rmSync(TEST_DB, { force: true });
  fs.rmSync(TEST_DB + '-journal', { force: true });
  fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });

  const opts = {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  };
  // Prefer bunx (bun environments), fall back to npx (plain node environments).
  try {
    execSync('bunx prisma db push --accept-data-loss', opts);
  } catch {
    execSync('npx --no-install prisma db push --accept-data-loss', opts);
  }
};
