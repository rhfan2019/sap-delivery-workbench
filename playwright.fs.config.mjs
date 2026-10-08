import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const installed = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
export default defineConfig({
  testDir: './tests/e2e/fs-workspace',
  outputDir: '.runtime/fs-e2e-results',
  workers: 1,
  timeout: 45000,
  reporter: [['list'], ['json', { outputFile: '.runtime/artifacts/fs-workspace/e2e.json' }]],
  use: {
    viewport: { width: 1440, height: 1000 },
    launchOptions: installed ? { executablePath: installed } : {},
    trace: 'retain-on-failure',
  },
});
