// Genera public/og-image.png (1200×630) desde scripts/brand/og-image.svg con el Chromium de Playwright.
//   pnpm og:render
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'scripts/brand/og-image.svg'), 'utf8');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  writeFileSync(
    join(root, 'public/og-image.png'),
    await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } }),
  );
} finally {
  await browser.close();
}
console.log('public/og-image.png generado (1200×630).');
