import { expect, test } from '@playwright/test';
import {
  addRectangle,
  canvasPoint,
  connect,
  edges,
  editAndSave,
  newProject,
  nodeNamed,
  renameBoard,
  signIn,
  uniq,
} from './helpers';

// Humo de extremo a extremo contra los emuladores (Auth 9099, Firestore 8080).
// Cada escenario entra con la cuenta de prueba y crea sus propios datos; no depende de los demás.

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
