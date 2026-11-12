import { expect, test, type Page } from '@playwright/test';
import { newProject, renameBoard, signIn, uniq } from './helpers';

// Maquetación sin desborde en ventanas estrechas (ronda 2): barra de la nota y panel «Compartir».

const ANCHOS = [390, 768, 900, 1024, 1440];

/** Todo el recuadro del elemento cae dentro de la ventana. */
async function dentroDeLaVentana(page: Page, nombre: string) {
  const box = await page.getByRole('button', { name: nombre, exact: true }).boundingBox();
  const ancho = page.viewportSize()!.width;
  expect(box, `${nombre} existe`).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(ancho);
}

test.describe('maquetación', () => {
  test('nota: Compartir y Biblioteca siguen a la vista y a un clic a cualquier ancho', async ({ page }) => {
    await signIn(page);
    await newProject(page, 'Nota');
    await expect(page.getByRole('radio', { name: 'Rectángulo' })).toBeVisible();
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 844 });
      for (const nombre of ['Volver al panel', 'Biblioteca', 'Compartir'])
        await dentroDeLaVentana(page, nombre);
      await expect(page.getByRole('textbox', { name: 'Título de la nota' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
      // Alcanzable de verdad: el clic llega al botón (nada lo tapa) y abre su panel.
      await page.getByRole('button', { name: 'Compartir', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Crear enlace' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });

  test('nota estrecha: la barra no tapa las herramientas de Excalidraw', async ({ page }) => {
    await signIn(page);
    await newProject(page, 'Nota');
    await page.setViewportSize({ width: 768, height: 844 });
    const barra = await page.getByRole('button', { name: 'Compartir', exact: true }).boundingBox();
    const herramienta = await page.getByRole('radio', { name: 'Rectángulo' }).locator('..').boundingBox();
    expect(barra!.y + barra!.height).toBeLessThanOrEqual(herramienta!.y);
  });

  for (const [tipo, nuevo] of [
    ['diagrama', 'Diagrama'],
    ['nota', 'Nota'],
  ] as const) {
    test(`${tipo}: el panel Compartir con invitaciones no se sale del popover (390 y 1440 px)`, async ({
      page,
    }) => {
      await signIn(page);
      await newProject(page, nuevo);
      if (nuevo === 'Diagrama') await renameBoard(page, uniq('Compartir'));
      for (const ancho of [390, 1440]) {
        await page.setViewportSize({ width: ancho, height: 900 });
        await page.getByRole('button', { name: 'Compartir', exact: true }).click();
        const panel = page.getByRole('dialog');
        const crear = panel.getByRole('button', { name: 'Crear enlace' });
        await crear.click();
        await expect(panel.getByRole('list', { name: 'Invitaciones vigentes' })).toBeVisible();
        await crear.click();
        await expect(panel.getByRole('listitem')).not.toHaveCount(0);
        const m = await panel.evaluate((el) => ({ cliente: el.clientWidth, scroll: el.scrollWidth }));
        expect(m.scroll).toBeLessThanOrEqual(m.cliente);
        await page.keyboard.press('Escape');
      }
    });
  }
});
