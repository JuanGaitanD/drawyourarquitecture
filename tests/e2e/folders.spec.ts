import { expect, test, type Page } from '@playwright/test';
import { signIn, uniq } from './helpers';

// Carpetas del panel contra los emuladores (Auth 9099, Firestore 8080). Nombres únicos por ejecución: la cuenta de
// prueba y su lista de proyectos se comparten entre escenarios.

/** «Nueva carpeta» (chip del final) → nombre → Crear. Deja la carpeta visible como chip del nivel actual. */
async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nueva carpeta' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva carpeta' });
  await dialog.getByRole('textbox', { name: 'Nombre de la carpeta' }).fill(name);
  await dialog.getByRole('button', { name: 'Crear' }).click();
  await expect(dialog).toBeHidden();
  await expect(chip(page, name)).toBeVisible();
}

/** Chip (enlace) de una carpeta por su nombre. */
const chip = (page: Page, name: string) => page.getByRole('link', { name: new RegExp(`^${name}\\s*,\\s*\\d+ elemento`) });

async function openFolder(page: Page, name: string) {
  await chip(page, name).click();
  await expect(page).toHaveURL(/\/folder\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Espera a que el panel termine de cargar los proyectos (el esqueleto marca `aria-busy`). */
const loaded = (page: Page) => expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

test.describe('carpetas', () => {
  test('crear anidadas, nota dentro con el botón, buscar y mover a Inicio', async ({ page }) => {
    const uni = uniq('Universidad');
    const sem = uniq('Semestre 5');
    const nota = uniq('Apuntes');
    await signIn(page);

    // Universidad en la raíz; dentro, Semestre 5.
    await createFolder(page, uni);
    await openFolder(page, uni);
    const crumbs = page.getByRole('navigation', { name: 'Ruta de la carpeta' });
    await expect(crumbs.getByRole('link', { name: 'Inicio' })).toBeVisible();
    // Dentro de una carpeta no están las tarjetas grandes «Nuevo».
    await expect(page.getByRole('heading', { name: 'Nuevo', exact: true })).toHaveCount(0);
    await createFolder(page, sem);
    await openFolder(page, sem);
    await expect(crumbs.getByRole('link', { name: uni })).toBeVisible();
    await expect(crumbs.getByText(sem)).toHaveAttribute('aria-current', 'page');

    // Nota con el botón compacto de la carpeta: se crea con su folderId y abre el editor.
    await expect(page.getByRole('button', { name: `Nuevo diagrama en ${sem}` })).toBeVisible();
    await page.getByRole('button', { name: `Nueva nota en ${sem}` }).click();
    await expect(page).toHaveURL(/\/note\/[^/]+$/);
    await page.getByRole('button', { name: 'Volver al panel' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Vuelve a la carpeta por los chips y le pone nombre a la nota desde el menú de su tarjeta.
    await openFolder(page, uni);
    await openFolder(page, sem);
    await page.getByRole('button', { name: 'Opciones de «Sin título»' }).click();
    await page.getByRole('menuitem', { name: 'Renombrar' }).click();
    const rename = page.getByRole('textbox', { name: 'Nuevo nombre de «Sin título»' });
    await rename.fill(nota);
    await rename.press('Enter');
    await expect(page.getByRole('link', { name: new RegExp(nota) })).toBeVisible();

    // En Inicio no aparece (está dentro de la carpeta)…
    await crumbs.getByRole('link', { name: 'Inicio' }).click();
    await expect(page).toHaveURL(/\/$/);
    await loaded(page);
    await expect(chip(page, uni)).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(nota) })).toHaveCount(0);

    // …pero la búsqueda cruza todas las carpetas y la tarjeta muestra la suya.
    await page.getByRole('searchbox', { name: 'Buscar proyectos por título' }).fill(nota);
    const card = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(nota) }) });
    await expect(card).toBeVisible();
    await expect(card.getByText(`${uni} / ${sem}`)).toBeVisible();

    // Moverla a Inicio desde su menú.
    await card.getByRole('button', { name: `Opciones de «${nota}»` }).click();
    await page.getByRole('menuitem', { name: 'Mover a carpeta…' }).click();
    const dialog = page.getByRole('dialog', { name: `Mover «${nota}»` });
    await expect(dialog.getByRole('radio', { name: sem })).toBeChecked();
    await dialog.getByRole('radio', { name: 'Sin carpeta (Inicio)' }).check({ force: true });
    await dialog.getByRole('button', { name: 'Mover' }).click();
    await expect(dialog).toBeHidden();

    // Sin búsqueda, ahora sí está en la raíz y la tarjeta ya no lleva carpeta.
    await page.getByRole('button', { name: 'Borrar búsqueda' }).click();
    const root = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(nota) }) });
    await expect(root).toBeVisible();
    await expect(root.getByText(sem)).toHaveCount(0);
  });

  test('una carpeta con contenido no se borra y una vacía sí', async ({ page }) => {
    const padre = uniq('Trabajo');
    const hija = uniq('Cliente');
    await signIn(page);
    await createFolder(page, padre);
    await openFolder(page, padre);
    await createFolder(page, hija);
    await page.getByRole('navigation', { name: 'Ruta de la carpeta' }).getByRole('link', { name: 'Inicio' }).click();

    await page.getByRole('button', { name: `Opciones de la carpeta «${padre}»` }).click();
    await expect(page.getByRole('menuitem', { name: 'Borrar' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Mueve o borra su contenido primero')).toBeVisible();
    await page.keyboard.press('Escape');

    await openFolder(page, padre);
    await page.getByRole('button', { name: `Opciones de la carpeta «${hija}»` }).click();
    await page.getByRole('menuitem', { name: 'Borrar' }).click();
    await expect(chip(page, hija)).toHaveCount(0);
  });

  test('una carpeta inexistente avisa y enlaza a Inicio', async ({ page }) => {
    await signIn(page);
    await page.goto('/folder/no-existe');
    await expect(page.getByText('Esta carpeta no existe')).toBeVisible();
    await page.getByRole('link', { name: 'Ir a Inicio' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
