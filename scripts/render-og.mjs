/* global document -- dentro de page.evaluate, que corre en el navegador */
// Genera public/og-image.png (1200×630) desde scripts/brand/og-image.svg con el Chromium de Playwright.
//   pnpm og:render
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'scripts/brand/og-image.svg'), 'utf8');

// La tipografía de la marca (IBM Plex Sans, la que ya está instalada como @fontsource) se incrusta en la página en base64:
// el render no depende de las fuentes del sistema y es igual en cualquier máquina.
const WEIGHTS = [400, 500, 600];
const fonts = WEIGHTS.map((w) => {
  const file = join(root, `node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${w}-normal.woff2`);
  return `@font-face{font-family:'IBM Plex Sans';font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format('woff2')}`;
}).join('');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(`<style>${fonts}</style><body style="margin:0">${svg}</body>`);
  // Sin la fuente cargada el texto saldría en la de respaldo: si falta, se aborta en lugar de generar una imagen distinta.
  const cargadas = await page.evaluate(async (pesos) => {
    await Promise.all(pesos.map((w) => document.fonts.load(`${w} 40px "IBM Plex Sans"`)));
    return pesos.every((w) => document.fonts.check(`${w} 40px "IBM Plex Sans"`));
  }, WEIGHTS);
  if (!cargadas) throw new Error('IBM Plex Sans no se cargó: falta @fontsource/ibm-plex-sans (pnpm install).');
  writeFileSync(
    join(root, 'public/og-image.png'),
    await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } }),
  );
} finally {
  await browser.close();
}
console.log('public/og-image.png generado (1200×630).');
