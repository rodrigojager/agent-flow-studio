const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  testMatch: ["tools/ui-theme-audit.spec.cjs"],
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  workers: 1,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tools/run-ui-audit-api.cjs",
      url: "http://127.0.0.1:3433/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node tools/run-ui-audit-ui.cjs",
      url: "http://127.0.0.1:5273",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
