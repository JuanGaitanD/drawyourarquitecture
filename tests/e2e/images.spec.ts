import { expect, test, type Page } from '@playwright/test';
import {
  createInvite,
  drawRectangle,
  dropImage,
  joinAs,
  newNote,
  newProject,
  pngBytes,
  rectangles,
  renameBoard,
  signIn,
  uniq,
} from './helpers';

// Imágenes de extremo a extremo con dos contextos: se suben al guardado en Firestore (troceadas) y la otra persona
// las ve. Mismo esquema que collab.spec.ts: el dueño y una invitada con otra cuenta de prueba.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

type H = {
  h?: {
    elements: { id: string; type: string; isDeleted: boolean; fileId?: string }[];
    app: { files: Record<string, unknown> };
  };
};

/** Imágenes vivas de la escena de Excalidraw y cuántas ya tienen su binario cargado. */
const noteImages = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as H).h;
    const images = (h?.elements ?? []).filter((e) => e.type === 'image' && !e.isDeleted);
    return { total: images.length, loaded: images.filter((e) => e.fileId && h?.app.files[e.fileId]).length };
  });

/** Nodo de imagen del board: su <img> está en el DOM y ya decodificó píxeles (no es el marcador de carga). */
async function expectImageLoaded(page: Page, name: string) {
  const img = page.getByRole('img', { name, exact: true });
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
}

test.describe('imágenes e2e', () => {
  test('nota: la imagen que sube una persona la ve la otra, ya cargada', async ({
    page,
    browser,
    baseURL,
  }) => {
    await newNote(page);
    const link = await createInvite(page, 'Puede editar');
    await page.keyboard.press('Escape');
    const { context, page: guest } = await joinAs(browser, baseURL ?? '', link);
    try {
      await expect(guest.getByRole('radio', { name: 'Rectángulo' })).toBeVisible();

      await dropImage(page, 'roja.png', pngBytes(96, 64, [220, 60, 60]), { x: 400, y: 350 });
      await expect.poll(() => noteImages(page)).toEqual({ total: 1, loaded: 1 });

      // La subida termina y se guarda: la invitada recibe el elemento y descarga el binario.
      await expect.poll(() => noteImages(guest), { timeout: 30_000 }).toEqual({ total: 1, loaded: 1 });
    } finally {
      await context.close();
    }
  });

  test('diagrama: la imagen de un nodo la ve la otra persona y sobrevive a recargar', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page);
    await newProject(page, 'Diagrama');
    await renameBoard(page, uniq('Con imagen'));
    const link = await createInvite(page, 'Puede editar');
    await page.keyboard.press('Escape');
    const { context, page: guest } = await joinAs(browser, baseURL ?? '', link);
    try {
      await expect(guest.getByRole('button', { name: 'Formas', exact: true })).toBeVisible();

      // «Imagen» abre el selector de archivos del navegador: se responde con un PNG generado al vuelo.
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Imagen', exact: true }).click();
      await (
        await chooser
      ).setFiles({ name: 'azul.png', mimeType: 'image/png', buffer: pngBytes(96, 64, [40, 80, 220]) });

      for (const p of [page, guest]) await expectImageLoaded(p, 'azul.png');
      await page.reload();
      await expectImageLoaded(page, 'azul.png');
    } finally {
      await context.close();
    }
  });

  // Corrección 6 de la revisión 2: una imagen se publica en el contenido solo cuando su subida se confirma (D8). Si
  // el autor sigue dibujando con la subida en curso, la otra persona ve lo demás sin errores y la imagen le llega al
  // terminar. Las escrituras del dueño a Firestore se retrasan para alargar la ventana de la subida.
  test('nota: una imagen aún en subida no rompe a la otra persona y le llega al terminar', async ({
    page,
    browser,
    baseURL,
  }) => {
    await newNote(page);
    const link = await createInvite(page, 'Puede editar');
    await page.keyboard.press('Escape');
    const { context, page: guest } = await joinAs(browser, baseURL ?? '', link);
    try {
      await expect(guest.getByRole('radio', { name: 'Rectángulo' })).toBeVisible();
      const errors: string[] = [];
      guest.on('pageerror', (e) => errors.push(e.message));

      // Compuerta observable: la escritura del archivo (meta y trozos, rutas /files/, por el canal de escritura de
      // Firestore) queda retenida hasta soltarla. El contenido del proyecto (transacción :commit) pasa sin demora.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let held = 0;
      await page.route('**/Write/channel**', async (route) => {
        if (decodeURIComponent(route.request().postData() ?? '').includes('/files/')) {
          held++;
          await gate;
        }
        await route.continue();
      });
      await dropImage(page, 'lenta.png', pngBytes(96, 64, [30, 160, 90]), { x: 400, y: 350 });
      await expect.poll(() => held).toBeGreaterThan(0); // la subida está en vuelo y sin confirmar
      await expect.poll(() => noteImages(page)).toEqual({ total: 1, loaded: 1 });
      await drawRectangle(page, { x: 800, y: 450 }); // sigue editando con la subida en curso

      // La invitada recibe el rectángulo y todavía ni la imagen ni errores: la referencia no se publica sin confirmar.
      await expect.poll(() => rectangles(guest), { timeout: 30_000 }).toBe(1);
      expect(await noteImages(guest)).toEqual({ total: 0, loaded: 0 });
      expect(errors).toEqual([]);

      release();
      await expect.poll(() => noteImages(guest), { timeout: 30_000 }).toEqual({ total: 1, loaded: 1 });
      expect(errors).toEqual([]);
      await expect(guest.getByRole('region', { name: 'Notificaciones' }).getByText(/No se pudo/)).toHaveCount(
        0,
      );
    } finally {
      await context.close();
    }
  });
});
