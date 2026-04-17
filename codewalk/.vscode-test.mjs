import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: [
    "out/test/suite/**/*.test.js",
    "out/test/integration/**/*.test.js",
    "out/test/eval/**/*.test.js",
  ],
  mocha: {
    ui: "tdd",
    timeout: 120000,
    color: true,
  },
});
