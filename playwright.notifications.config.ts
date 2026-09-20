import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', testMatch: 'notifications.spec.ts', fullyParallel: false, reporter: 'list', use: { baseURL: 'http://127.0.0.1:3108', screenshot: 'only-on-failure' }, projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
