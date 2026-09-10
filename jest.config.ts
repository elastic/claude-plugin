import type { Config } from 'jest';

const config: Config = {
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
};

export default config;
