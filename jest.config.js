"use strict";

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",

  // Discover all tests under tests/
  testMatch: ["**/tests/**/*.test.js"],

  // Generous timeout for integration tests that hit the live server
  testTimeout: 20000,

  // CJS — no transform needed
  transform: {},

  // Coverage settings (run with --coverage flag)
  collectCoverageFrom: [
    "lib/**/*.js",
    "common/**/*.js",
    "!lib/broker/index.js", // Redis connection — not unit-testable in isolation
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],

  // Silence excessive console output from modules during tests
  // (set to false when debugging a failing test)
  silent: false,

  // Force Jest to exit after all tests complete, preventing hangs from
  // open handles (Redis/HTTP connections in integration tests)
  forceExit: true,

  // Increase max old space for heavy test suites
  // (Node 18 default is usually sufficient)
};
