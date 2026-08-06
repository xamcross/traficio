import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4300' },
  webServer: { command: 'npx ng serve --port 4300', url: 'http://localhost:4300', reuseExistingServer: true, timeout: 120000 },
});
