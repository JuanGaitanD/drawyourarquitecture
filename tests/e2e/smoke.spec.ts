import { expect, test, type Page } from '@playwright/test';

// Humo de extremo a extremo contra los emuladores (Auth 9099, Firestore 8080).
// Cada escenario entra con la cuenta de prueba y crea sus propios datos; no depende de los demás.

/** Título único por ejecución: los proyectos se listan por título en el panel y en «Insertar diagrama». */
const uniq = (base: string) => `${base} ${Date.now().toString(36)}`;

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar con la cuenta de prueba' }).click();
  await expect(page.getByRole('heading', { name: /^Hola/ })).toBeVisible();
}

/** «Nuevo» del panel: una tarjeta por tipo. Entra al editor del proyecto creado. */
async function newProject(page: Page, kind: 'Nota' | 'Diagrama') {
  await page.getByRole('button', { name: new RegExp(`^${kind}\\b`) }).click();
  await expect(page).toHaveURL(kind === 'Nota' ? /\/note\/[^/]+$/ : /\/board\/[^/]+$/);
}

async function renameBoard(page: Page, title: string) {
  const field = page.getByRole('textbox', { name: 'Título del diagrama' });
  await expect(field).toBeVisible();
  await field.fill(title);
  await field.press('Enter');
  await expect(field).toHaveValue(title);
}

/**
 * Ejecuta una edición de contenido y espera a que el indicador vuelva a «Guardado» después de ella.
 * Antes de editar ya pone «Guardado», y el guardado se dispara 250 ms después del cambio, así que una
 * aserción directa pasaría antes de tiempo. Por eso se observa el propio indicador mientras ocurre la edición
 * y se resuelve cuando su texto vuelve a «Guardado» tras algún cambio.
 */
async function editAndSave(page: Page, edit: () => Promise<void>) {
  const badge = page.getByRole('status').filter({ hasText: /Guardad|Guardando/ });
  const saved = badge.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (el.textContent?.trim() === 'Guardado') {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(el, { subtree: true, childList: true, characterData: true });
      }),
  );
  await edit();
  await saved;
  await expect(badge).toHaveText('Guardado');
}

/** Punto central del lienzo más un desplazamiento horizontal: el lienzo ocupa la pantalla entre las barras. */
function canvasPoint(page: Page, dx: number) {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 800 };
  return { x: width / 2 + dx, y: height / 2 };
}

/** Herramienta «Rectángulo» + clic en el lienzo + texto del nodo. Un paso de edición. */
async function addRectangle(page: Page, at: { x: number; y: number }, label: string) {
  await page.getByRole('button', { name: 'Formas', exact: true }).click();
  await page.getByRole('button', { name: 'Rectángulo', exact: true }).click();
  await page.mouse.click(at.x, at.y);
  const text = page.getByRole('textbox', { name: 'Texto', exact: true });
  await expect(text).toBeFocused();
  await text.fill(label);
  await text.press('Enter');
  await expect(text).toBeHidden();
  await expect(nodeNamed(page, label)).toBeVisible();
}

/** Nodo del lienzo por su texto. React Flow da a cada nodo el papel «group». */
const nodeNamed = (page: Page, label: string) =>
  page.getByRole('group').filter({ has: page.getByText(label, { exact: true }) });

/** Conectores del lienzo (React Flow los etiqueta «Edge from …»). */
const edges = (page: Page) => page.getByLabel(/^Edge from /);

/**
 * Arrastra desde el punto de conexión derecho del origen hasta el izquierdo del destino. Se apuntan en el borde de
 * cada nodo, donde NodeChrome los coloca: centro del lado derecho y del izquierdo (también tienen nombre accesible:
 * «Conectar desde el lado derecho»).
 */
async function connect(page: Page, from: string, to: string) {
  const a = await nodeNamed(page, from).boundingBox();
  const b = await nodeNamed(page, to).boundingBox();
  if (!a || !b) throw new Error('Los nodos no están visibles');
  await page.mouse.move(a.x + a.width, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe('humo e2e', () => {
  test('diagrama: forma y conector persisten tras recargar', async ({ page }) => {
    await signIn(page);
    await newProject(page, 'Diagrama');
    await renameBoard(page, uniq('Arquitectura'));
    await expect(page.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();

    await editAndSave(page, () => addRectangle(page, canvasPoint(page, -220), 'API'));
    await editAndSave(page, () => addRectangle(page, canvasPoint(page, 220), 'Base de datos'));
    await editAndSave(page, () => connect(page, 'API', 'Base de datos'));
    await expect(edges(page)).toHaveCount(1);

    await page.reload();

    await expect(nodeNamed(page, 'API')).toBeVisible();
    await expect(nodeNamed(page, 'Base de datos')).toBeVisible();
    await expect(edges(page)).toHaveCount(1);
  });

  test('nota: insertar un diagrama y verlo en el lienzo', async ({ page }) => {
    await signIn(page);
    await newProject(page, 'Diagrama');
    const title = uniq('Servicios');
    await renameBoard(page, title);
    await editAndSave(page, () => addRectangle(page, canvasPoint(page, 0), 'Servicio de pagos'));
    await page.getByRole('button', { name: 'Volver al panel' }).click();
    await expect(page).toHaveURL(/\/$/);

    await newProject(page, 'Nota');
    await page.getByTestId('main-menu-trigger').click();
    await page.getByRole('button', { name: 'Insertar diagrama', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Insertar diagrama' });
    await dialog.getByRole('button', { name: new RegExp(title) }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText('Servicio de pagos', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir', exact: true })).toBeVisible();
  });

  test('público: el lienzo se ve sin sesión y deja de verse al despublicar', async ({ page, browser }) => {
    await signIn(page);
    await newProject(page, 'Diagrama');
    const title = uniq('Publicado');
    await renameBoard(page, title);
    await editAndSave(page, () => addRectangle(page, canvasPoint(page, 0), 'Capa web'));
    const boardId = new URL(page.url()).pathname.split('/').at(-1) ?? '';

    await page.getByRole('button', { name: 'Compartir', exact: true }).click();
    await page.getByRole('button', { name: 'Publicar enlace', exact: true }).click();
    await expect(page.getByText('Cualquiera con el enlace puede verlo')).toBeVisible();
    await page.keyboard.press('Escape');

    // Contexto nuevo: sin la sesión del dueño (IndexedDB y localStorage vacíos).
    const anonymous = await browser.newContext();
    try {
      const guest = await anonymous.newPage();
      await guest.goto(new URL(`/view/board/${boardId}`, page.url()).href);
      await expect(guest.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(guest.getByText('Solo lectura', { exact: true })).toBeVisible();
      await expect(guest.getByText('Capa web', { exact: true })).toBeVisible();
      await expect(guest.getByRole('link', { name: 'Editar', exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Compartir', exact: true }).click();
      await page.getByRole('button', { name: 'Dejar de compartir', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Publicar enlace', exact: true })).toBeVisible();

      await guest.reload();
      await expect(guest.getByRole('status').filter({ hasText: 'No existe o es privado' })).toBeVisible();
    } finally {
      await anonymous.close();
    }
  });
});
