import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  addRectangle,
  canvasPoint,
  editAndSave,
  newProject,
  nodeNamed,
  renameBoard,
  signIn,
  uniq,
} from './helpers';

// Colaboración de extremo a extremo con dos contextos de navegador: el dueño (`owner-test`) y una persona invitada
// que entra como otra cuenta de prueba (`localStorage['dya:testUser']`). Necesita Realtime Database (presencia): la
// levanta `global-setup.ts`.

// El dueño copia el enlace de invitación al portapapeles y el test lo lee de ahí.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

type Role = 'Puede editar' | 'Solo lectura';
type Scene = { h?: { elements: { type: string; isDeleted: boolean }[] } };

/** El dueño abre «Compartir», crea un enlace con el rol y devuelve su URL. Deja el panel abierto. */
async function createInvite(owner: Page, role: Role): Promise<string> {
  await owner.getByRole('button', { name: 'Compartir', exact: true }).click();
  await owner.getByRole('combobox', { name: 'Rol de la invitación' }).selectOption({ label: role });
  // En la nota, Excalidraw tiene otro botón «Crear enlace» (herramienta de enlace): se acota al panel.
  await owner.getByRole('dialog').getByRole('button', { name: 'Crear enlace' }).click();
  await expect(owner.getByText('Enlace de invitación copiado')).toBeVisible();
  return owner.evaluate(() => navigator.clipboard.readText());
}

/** Segunda persona: contexto propio (sin la sesión del dueño) que entra con `uid` y acepta la invitación. */
async function joinAs(browser: Browser, baseURL: string, link: string) {
  // Cuenta de prueba nueva por ejecución: la lista de miembros del dueño no arrastra a nadie de otras pruebas.
  const uid = `guest-${Math.random().toString(36).slice(2, 8)}`;
  const context = await browser.newContext({ baseURL });
  await context.addInitScript((u) => localStorage.setItem('dya:testUser', u), uid);
  const page = await context.newPage();
  await page.goto(new URL(link).pathname);
  await page.getByRole('button', { name: 'Entrar con la cuenta de prueba' }).click();
  await expect(page).toHaveURL(/\/(board|note)\/[^/]+$/);
  return { context, page };
}

/** Rectángulos vivos del lienzo de Excalidraw (el hook de pruebas `window.h` existe en el servidor de desarrollo). */
const rectangles = (page: Page) =>
  page.evaluate(
    () =>
      ((window as unknown as Scene).h?.elements ?? []).filter((e) => e.type === 'rectangle' && !e.isDeleted)
        .length,
  );

/** Herramienta «Rectángulo» de Excalidraw y arrastre en el lienzo. */
async function drawRectangle(page: Page, from: { x: number; y: number }) {
  await page.getByRole('radio', { name: 'Rectángulo' }).check({ force: true }); // el icono tapa el radio
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 60, { steps: 6 });
  await page.mouse.up();
}

async function newNote(page: Page) {
  await signIn(page);
  await newProject(page, 'Nota');
  await expect(page.getByRole('radio', { name: 'Rectángulo' })).toBeVisible();
}

test.describe('colaboración e2e', () => {
  test('editor: dueño e invitada editan a la vez un diagrama y se ven', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page);
    await newProject(page, 'Diagrama');
    await renameBoard(page, uniq('Compartido'));
    const link = await createInvite(page, 'Puede editar');
    await page.keyboard.press('Escape');

    const { context, page: guest } = await joinAs(browser, baseURL ?? '', link);
    try {
      await expect(guest.getByRole('button', { name: 'Formas', exact: true })).toBeVisible();

      // A la vez: cada una crea su forma sin esperar a la otra.
      await Promise.all([
        editAndSave(page, () => addRectangle(page, canvasPoint(page, -260), 'Del dueño')),
        editAndSave(guest, () => addRectangle(guest, canvasPoint(guest, 260), 'De la invitada')),
      ]);

      for (const p of [page, guest]) {
        await expect(nodeNamed(p, 'Del dueño')).toBeVisible();
        await expect(nodeNamed(p, 'De la invitada')).toBeVisible();
      }
      // Y nada se perdió al guardar a la vez: tras recargar, el dueño sigue viendo las dos.
      await page.reload();
      await expect(nodeNamed(page, 'Del dueño')).toBeVisible();
      await expect(nodeNamed(page, 'De la invitada')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('editor: dueño e invitada dibujan a la vez en una nota y se ven', async ({
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
      await Promise.all([drawRectangle(page, { x: 300, y: 300 }), drawRectangle(guest, { x: 800, y: 450 })]);

      for (const p of [page, guest]) await expect.poll(() => rectangles(p)).toBe(2);
      await page.reload();
      await expect.poll(() => rectangles(page)).toBe(2);
    } finally {
      await context.close();
    }
  });

  test('viewer: entra al diagrama y a la nota pero no puede editar', async ({ page, browser, baseURL }) => {
    await signIn(page);
    await newProject(page, 'Diagrama');
    await renameBoard(page, uniq('Solo lectura'));
    await editAndSave(page, () => addRectangle(page, canvasPoint(page, 0), 'Visible'));
    const boardLink = await createInvite(page, 'Solo lectura');
    await page.keyboard.press('Escape');

    const board = await joinAs(browser, baseURL ?? '', boardLink);
    try {
      await expect(board.page.getByText('Visible', { exact: true })).toBeVisible();
      await expect(board.page.getByText('Solo lectura', { exact: true })).toBeVisible();
      await expect(board.page.getByRole('button', { name: 'Formas', exact: true })).toHaveCount(0);
      await expect(board.page.getByRole('button', { name: 'Compartir', exact: true })).toHaveCount(0);
    } finally {
      await board.context.close();
    }

    await page.getByRole('button', { name: 'Volver al panel' }).click();
    await newProject(page, 'Nota');
    await expect(page.getByRole('radio', { name: 'Rectángulo' })).toBeVisible();
    await drawRectangle(page, { x: 300, y: 300 });
    await expect.poll(() => rectangles(page)).toBe(1);
    const noteLink = await createInvite(page, 'Solo lectura');
    await page.keyboard.press('Escape');

    const note = await joinAs(browser, baseURL ?? '', noteLink);
    try {
      await expect.poll(() => rectangles(note.page)).toBe(1);
      await expect(note.page.getByRole('radio', { name: 'Rectángulo' })).toHaveCount(0);
      await note.page.mouse.move(800, 450);
      await note.page.mouse.down();
      await note.page.mouse.move(900, 520, { steps: 6 });
      await note.page.mouse.up();
      expect(await rectangles(note.page)).toBe(1);
      await expect(note.page.getByRole('textbox', { name: 'Título de la nota' })).not.toBeEditable();
    } finally {
      await note.context.close();
    }
  });

  test('revocar y quitar: quien entró con el enlace pierde el acceso y el enlace deja de valer', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page);
    await newProject(page, 'Diagrama');
    await renameBoard(page, uniq('Privado'));
    const link = await createInvite(page, 'Puede editar');
    await page.keyboard.press('Escape');

    const { context, page: guest } = await joinAs(browser, baseURL ?? '', link);
    try {
      await expect(guest.getByRole('button', { name: 'Formas', exact: true })).toBeVisible();

      // El panel se carga al abrirse: ahora ya muestra a la persona que entró.
      await page.getByRole('button', { name: 'Compartir', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Miembros' }).getByRole('listitem')).toHaveCount(1);
      await page.getByRole('button', { name: 'Revocar y quitar a quienes entraron con este enlace' }).click();
      await expect(page.getByText('Solo tú, por ahora.')).toBeVisible();

      await guest.reload();
      await expect(guest.getByRole('heading', { name: 'No existe o es privado' })).toBeVisible();

      // El mismo enlace ya no sirve para volver a entrar.
      await guest.goto(new URL(link).pathname);
      await expect(
        guest.getByRole('heading', { name: 'La invitación no es válida o ha caducado' }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
