import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';

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

/** PNG sólido válido de `w`×`h` (RGB) generado al vuelo: sin binarios en el repositorio. */
export function pngBytes(w = 96, h = 64, [r, g, b]: [number, number, number] = [220, 60, 60]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, sin entrelazado
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Excalidraw (notas): suelta una imagen sobre el lienzo, como arrastrarla desde el escritorio. */
export async function dropImage(page: Page, name: string, png: Buffer, at: { x: number; y: number }) {
  await page.evaluate(
    ({ b64, name, at }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: 'image/png' }));
      const target = document.querySelector('.excalidraw__canvas.interactive') ?? document.body;
      target.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          clientX: at.x,
          clientY: at.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { b64: png.toString('base64'), name, at },
  );
}

// Colaboración de dos contextos (la usan collab.spec.ts e images.spec.ts). Necesita Realtime Database (presencia).
export type Role = 'Puede editar' | 'Solo lectura';
export type Scene = { h?: { elements: { type: string; isDeleted: boolean }[] } };

/** El dueño abre «Compartir», crea un enlace con el rol y devuelve su URL. Deja el panel abierto. */
export async function createInvite(owner: Page, role: Role): Promise<string> {
  await owner.getByRole('button', { name: 'Compartir', exact: true }).click();
  await owner.getByRole('combobox', { name: 'Rol de la invitación' }).selectOption({ label: role });
  // En la nota, Excalidraw tiene otro botón «Crear enlace» (herramienta de enlace): se acota al panel.
  await owner.getByRole('dialog').getByRole('button', { name: 'Crear enlace' }).click();
  await expect(owner.getByText('Enlace de invitación copiado')).toBeVisible();
  return owner.evaluate(() => navigator.clipboard.readText());
}

/** Segunda persona: contexto propio (sin la sesión del dueño) que entra con `uid` y acepta la invitación. */
export async function joinAs(
  browser: Browser,
  baseURL: string,
  link: string,
  /** Prepara el contexto antes de abrir el enlace (p. ej. retrasar un chunk con `route`). */
  prepare?: (context: BrowserContext) => Promise<unknown>,
) {
  // Cuenta de prueba nueva por ejecución: la lista de miembros del dueño no arrastra a nadie de otras pruebas.
  const uid = `guest-${Math.random().toString(36).slice(2, 8)}`;
  const context = await browser.newContext({ baseURL });
  await context.addInitScript((u) => localStorage.setItem('dya:testUser', u), uid);
  await prepare?.(context);
  const page = await context.newPage();
  await page.goto(new URL(link).pathname);
  await page.getByRole('button', { name: 'Entrar con la cuenta de prueba' }).click();
  await expect(page).toHaveURL(/\/(board|note)\/[^/]+$/);
  return { context, page };
}

/** Rectángulos vivos del lienzo de Excalidraw (el hook de pruebas `window.h` existe en el servidor de desarrollo). */
export const rectangles = (page: Page) =>
  page.evaluate(
    () =>
      ((window as unknown as Scene).h?.elements ?? []).filter((e) => e.type === 'rectangle' && !e.isDeleted)
        .length,
  );

/** Herramienta «Rectángulo» de Excalidraw y arrastre en el lienzo. */
export async function drawRectangle(page: Page, from: { x: number; y: number }) {
  await page.getByRole('radio', { name: 'Rectángulo' }).check({ force: true }); // el icono tapa el radio
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 60, { steps: 6 });
  await page.mouse.up();
}

export async function newNote(page: Page) {
  await signIn(page);
  await newProject(page, 'Nota');
  await expect(page.getByRole('radio', { name: 'Rectángulo' })).toBeVisible();
}
