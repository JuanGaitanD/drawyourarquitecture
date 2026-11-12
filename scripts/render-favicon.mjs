// Genera los PNG del favicon desde public/favicon.svg con el Chromium de Playwright (sin dependencias nuevas).
//   pnpm favicon:render
// - public/favicon-32.png: 32×32, transparente (respaldo para navegadores sin favicon SVG, p. ej. Safari).
// - public/apple-touch-icon.png: 180×180, opaco y sin esquinas redondeadas (iOS las aplica): el verde del sistema,
//   la marca (nodo, conector, nodo) y las marcas de registro de la firma.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const favicon = readFileSync(join(root, 'public/favicon.svg'), 'utf8');

// Mismo dibujo que favicon.svg, a sangre (sin redondeo) y con la marca algo más pequeña para que iOS recorte sin tocarla.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="180" height="180">
  <rect width="32" height="32" fill="#136a55"/>
  <g transform="translate(16 16) scale(.84) translate(-16 -16)" fill="#f9fdfb" stroke="#f9fdfb">
    <path d="M14 11.5h4a4 4 0 0 1 4 4V18" fill="none" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="6" y="7.5" width="8.5" height="8.5" rx="2.5" stroke="none"/>
    <circle cx="22" cy="22.5" r="4.75" stroke="none"/>
  </g>
  <path d="M3.5 7.5v-4h4M24.5 3.5h4v4M28.5 24.5v4h-4M3.5 24.5v4h4" fill="none" stroke="#f9fdfb" stroke-width="1.1" opacity=".55"/>
</svg>`;

const browser = await chromium.launch();
try {
  const shot = async (svg, size, opaque) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg.replace(/<svg /, `<svg style="display:block;width:${size}px;height:${size}px" `)}</div></body>`,
    );
    const png = await page.screenshot({
      type: 'png',
      omitBackground: !opaque,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
    return png;
  };
  writeFileSync(join(root, 'public/favicon-32.png'), await shot(favicon, 32, false));
  writeFileSync(join(root, 'public/apple-touch-icon.png'), await shot(apple, 180, true));
} finally {
  await browser.close();
}
console.log('public/favicon-32.png (32×32) y public/apple-touch-icon.png (180×180) generados.');
