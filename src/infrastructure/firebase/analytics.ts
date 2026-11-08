import { app, USE_EMULATORS } from './firebase';

// Analytics solo en producción, con measurementId y si el navegador lo admite. Se carga con import()
// para no sumar al bundle inicial. Los eventos no llevan títulos ni datos personales.

export type AnalyticsEvent =
  | { name: 'project_create'; params: { type: 'note' | 'board' } }
  | { name: 'project_publish'; params?: undefined }
  | { name: 'board_embed_insert'; params?: undefined }
  | { name: 'export'; params: { format: 'png' | 'json' } };

const enabled = import.meta.env.PROD && !USE_EMULATORS && Boolean(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID);

let analytics: Promise<((e: AnalyticsEvent) => void) | null> | null = null;

function load() {
  analytics ??= import('firebase/analytics')
    .then(async ({ isSupported, getAnalytics, logEvent }) => {
      if (!(await isSupported())) return null;
      const instance = getAnalytics(app);
      return (e: AnalyticsEvent) => logEvent(instance, e.name, e.params);
    })
    .catch(() => null);
  return analytics;
}

/** Nunca lanza: si Analytics no está disponible, el evento se descarta. */
export function track(event: AnalyticsEvent): void {
  if (!enabled) return;
  void load().then((log) => log?.(event));
}
