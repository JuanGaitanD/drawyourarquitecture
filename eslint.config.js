import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// Regla de dependencia entre capas (docs/plan.md · «Regla de dependencia»):
//   domain ← application ← infrastructure; editors y app consumen application y domain;
//   solo app/ conecta infrastructure/firebase.
const MOTORES = [
  'react',
  'react-dom',
  'react/*',
  'react-dom/*',
  'zustand',
  'zustand/*',
  'zundo',
  '@xyflow/*',
  '@excalidraw/*',
];
const FIREBASE = ['firebase', 'firebase/*', '@firebase/*'];
const capa = (nombre, rutas, extra = []) => ({
  files: rutas,
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          ...extra,
          // Solo rutas internas (alias @/ o relativas): así «firebase/app» no choca con la capa app/.
          ...nombre.map((n) => ({
            regex: `^(@/|(\\.{1,2}/)+)${n}(/|$)`,
            message: `Prohibido por la regla de dependencia (AGENTS.md).`,
          })),
        ],
      },
    ],
  },
});
const prohibe = (grupos, message) => ({ group: grupos, message });
const ENTRE_EDITORES = (otro) => ({
  regex: `^(@/editors/|(\\.\\./)+)${otro}(/|$)`,
  message: `Un editor no importa de editors/${otro}: lo común va en application/ (D37).`,
});

export default defineConfig([
  globalIgnores([
    'dist',
    'node_modules',
    '.wigi',
    '.firebase',
    'coverage',
    'api/_mcp.mjs',
    'public/excalidraw-assets',
    'playwright-report',
    'test-results',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Servidor MCP (función de Vercel): corre en Node.
  { files: ['src/server/**/*.ts', 'api/**/*.ts'], languageOptions: { globals: { ...globals.node } } },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },
  // domain: TypeScript puro.
  capa(
    ['application', 'infrastructure', 'editors', 'app', 'ui'],
    ['src/domain/**/*.ts'],
    [prohibe([...MOTORES, ...FIREBASE], 'domain no importa React, Firebase, zustand ni los motores.')],
  ),
  // application: puertos y casos de uso, sin framework ni SDK.
  capa(
    ['infrastructure', 'editors', 'app', 'ui'],
    ['src/application/**/*.ts'],
    [prohibe([...MOTORES, ...FIREBASE], 'application no importa React, Firebase, zustand ni los motores.')],
  ),
  // infrastructure: implementa los puertos; solo ella (y app/services) conoce el SDK.
  capa(
    ['editors', 'app', 'ui'],
    ['src/infrastructure/**/*.ts'],
    [prohibe([...MOTORES], 'infrastructure no importa React, zustand ni los motores.')],
  ),
  // editors: consumen application, domain y ui; el SDK y infrastructure son de app/.
  capa(
    ['infrastructure'],
    ['src/editors/**/*.{ts,tsx}'],
    [prohibe(FIREBASE, 'Los editores no importan el SDK de Firebase: usan los puertos de application.')],
  ),
  // Los editores no se importan entre sí (D37): lo común vive en application/. Excepción a propósito: la nota incrusta
  // el visor del board (BoardEmbed.tsx). Se repite el SDK porque la última regla que casa sustituye a las anteriores.
  capa(
    ['infrastructure'],
    ['src/editors/board/**/*.{ts,tsx}'],
    [prohibe(FIREBASE, 'Los editores no importan el SDK de Firebase: usan los puertos de application.'), ENTRE_EDITORES('note')],
  ),
  capa(
    ['infrastructure'],
    ['src/editors/note/**/*.{ts,tsx}'],
    [prohibe(FIREBASE, 'Los editores no importan el SDK de Firebase: usan los puertos de application.'), ENTRE_EDITORES('board')],
  ),
  capa(
    ['infrastructure'],
    ['src/editors/note/BoardEmbed.tsx'],
    [prohibe(FIREBASE, 'Los editores no importan el SDK de Firebase: usan los puertos de application.')],
  ),
  // model/: TypeScript puro; solo `import type` de @xyflow/react.
  {
    files: ['src/editors/board/model/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@xyflow/react',
              allowTypeImports: true,
              message: 'model/ solo puede hacer import type de @xyflow/react.',
            },
          ],
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'react/*',
                'react-dom/*',
                'zustand',
                'zustand/*',
                'zundo',
                '@excalidraw/*',
                ...FIREBASE,
              ],
              message: 'model/ es TypeScript puro.',
            },
            {
              regex:
                '^(@/|(\\.{1,2}/)+)(infrastructure|app|editors/board/(store|canvas|nodes|edges))(/|$)|^\\.\\./(store|canvas|nodes|edges)(/|$)',
              message: 'model/ no depende de capas superiores.',
            },
            ENTRE_EDITORES('note'),
          ],
        },
      ],
    },
  },
  // ui: primitivas sin conocimiento del dominio.
  capa(
    ['application', 'infrastructure', 'editors', 'app', 'domain'],
    ['src/ui/**/*.{ts,tsx}'],
    [prohibe(FIREBASE, 'ui no importa el SDK.')],
  ),
  // Los tests pueden cruzar capas.
  { files: ['**/*.test.{ts,tsx}', 'tests/**'], rules: { '@typescript-eslint/no-restricted-imports': 'off' } },
]);
