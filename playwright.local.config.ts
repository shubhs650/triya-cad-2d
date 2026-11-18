import base from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...base,
  reporter: [['list']],
  projects: base.projects!.map((p) => ({
    ...p,
    use: { ...p.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  })),
});
