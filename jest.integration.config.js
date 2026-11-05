/**
 * PostgreSQL-backed suite for the Prisma adapters (test/integration). Not part of
 * `npm test`: it needs DATABASE_URL pointing at a database migrated with
 * `prisma migrate deploy`, which CI provides as a service container.
 * @type {import('jest').Config}
 */
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the integration suite (see README, "Testing")');
}

module.exports = {
  displayName: 'integration',
  rootDir: '.',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testTimeout: 30_000,
};
