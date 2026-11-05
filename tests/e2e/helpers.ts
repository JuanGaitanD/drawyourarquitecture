import { expect, type Page } from '@playwright/test';

// Utilidades comunes de los e2e (humo y colaboración). Cada escenario crea sus propios datos.

/** Título único por ejecución: los proyectos se listan por título en el panel y en «Insertar diagrama». */
export const uniq = (base: string) => `${base} ${Date.now().toString(36)}`;

export async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar con la cuenta de prueba' }).click();
  await expect(page.getByRole('heading', { name: /^Hola/ })).toBeVisible();
}

/** «Nuevo» del panel: una tarjeta por tipo. Entra al editor del proyecto creado. */
export async function newProject(page: Page, kind: 'Nota' | 'Diagrama') {
  await page.getByRole('button', { name: new RegExp(`^${kind}\\b`) }).click();
  await expect(page).toHaveURL(kind === 'Nota' ? /\/note\/[^/]+$/ : /\/board\/[^/]+$/);
}

export async function renameBoard(page: Page, title: string) {
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
export async function editAndSave(page: Page, edit: () => Promise<void>) {
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
export function canvasPoint(page: Page, dx: number) {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 800 };
  return { x: width / 2 + dx, y: height / 2 };
}

/** Herramienta «Rectángulo» + clic en el lienzo + texto del nodo. Un paso de edición. */
export async function addRectangle(page: Page, at: { x: number; y: number }, label: string) {
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
export const nodeNamed = (page: Page, label: string) =>
  page.getByRole('group').filter({ has: page.getByText(label, { exact: true }) });

/** Conectores del lienzo (React Flow los etiqueta «Edge from …»). */
export const edges = (page: Page) => page.getByLabel(/^Edge from /);

/**
 * Arrastra desde el punto de conexión derecho del origen hasta el izquierdo del destino. Se apuntan en el borde de
 * cada nodo, donde NodeChrome los coloca: centro del lado derecho y del izquierdo (también tienen nombre accesible:
 * «Conectar desde el lado derecho»).
 */
export async function connect(page: Page, from: string, to: string) {
  const a = await nodeNamed(page, from).boundingBox();
  const b = await nodeNamed(page, to).boundingBox();
  if (!a || !b) throw new Error('Los nodos no están visibles');
  await page.mouse.move(a.x + a.width, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}
