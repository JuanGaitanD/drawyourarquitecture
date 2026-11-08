import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

export const OWNER = 'owner-test';
export const STRANGER = 'otra-cuenta';
/** Proyecto propio de la ejecución (`scripts/test-rules.mjs`): otro carril no puede limpiar ni recargar lo nuestro. */
export const PROJECT = process.env.RULES_PROJECT ?? 'demo-dya-rules';

export async function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
}

export const projectData = (over: Record<string, unknown> = {}) => ({
  ownerId: OWNER,
  type: 'board',
  title: 'Mi diagrama',
  isPublic: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

export const contentData = (over: Record<string, unknown> = {}) => ({
  data: '{"schemaVersion":1}',
  schemaVersion: 1,
  revision: 0,
  updatedAt: 1,
  ...over,
});

/** Crea un proyecto con su contenido saltándose las reglas (preparación del escenario). */
export async function seedProject(env: RulesTestEnvironment, id: string, over: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, 'projects', id), projectData(over));
    await setDoc(doc(fs, 'projects', id, 'content', 'main'), contentData());
  });
}
