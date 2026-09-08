module.exports = {
  testEnvironment: 'node',
  // env.js must run before any module reads process.env: config/database.js
  // builds its pool at require time.
  setupFiles: ['<rootDir>/tests/env.js'],
  globalSetup: '<rootDir>/tests/globalSetup.js',
  testTimeout: 20000,
  // The pool keeps the process alive; each suite closes its own.
  forceExit: false,
};
