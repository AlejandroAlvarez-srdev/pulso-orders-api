/** @type {import('jest').Config} */
const shared = {
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};

module.exports = {
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/prisma-*.ts'],
  projects: [
    { ...shared, displayName: 'unit', rootDir: '.', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    { ...shared, displayName: 'e2e', rootDir: '.', testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'] },
  ],
};
