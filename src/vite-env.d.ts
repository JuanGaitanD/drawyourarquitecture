/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** Reservada: el proyecto tiene Analytics, pero todavía no se integra. */
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  /** «1» conecta Auth y Firestore a los emuladores locales (proyecto demo-dya). */
  readonly VITE_USE_EMULATORS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Ruta base de las fuentes autoalojadas de Excalidraw; se fija en main.tsx antes de cargar el motor. */
  EXCALIDRAW_ASSET_PATH?: string | string[];
}
