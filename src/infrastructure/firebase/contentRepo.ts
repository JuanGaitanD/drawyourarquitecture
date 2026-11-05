import type { DocumentData, DocumentReference, Transaction } from 'firebase/firestore';
import { chunkCount, joinChunks, READ_ATTEMPTS, splitContent } from '@/application/contentChunks';
import type { ContentRecord, ContentRepo } from '@/application/ports';
import type { FirestoreModule } from './firestoreModule';
import { isPermissionDenied } from './errors';

// Contenido de un proyecto (D17). Fábrica sin dependencia de `firebase.ts` (`import.meta.env`): la usan la app
// (`content.ts`, con `loadFirestore`) y el servidor MCP (con su Firestore autenticado), que son clientes distintos.
//   projects/{id}/content/main                = { schemaVersion, revision, updatedAt, data }     (cabe en un documento)
//   projects/{id}/content/main                = { schemaVersion, revision, updatedAt, chunks: n } (n ≥ 2)
//   projects/{id}/content/main/chunks/{i}     = { data: string }                                  (≤ 900 000 bytes)
// Guardar escribe meta y trozos en la misma transacción (con la revisión esperada intacta); leer un contenido
// troceado también va en transacción para no mezclar trozos de dos revisiones. Un límite de una transacción de
// Firestore son 500 escrituras y ~10 MiB: con ≤ 12 trozos y 8 MiB de tope sobra.

const FORMAT_ERROR = 'El contenido guardado tiene un formato desconocido.';
/** Guardados seguidos que pueden perder la carrera del commit contra otros clientes antes de dar el error (D49). */
const SAVE_RACES = 10;

function toRecord(d: DocumentData, data: string): ContentRecord {
  return {
    data,
    schemaVersion: 1,
    revision: Number(d.revision) || 0,
    updatedAt: Number(d.updatedAt) || 0,
  };
}

/** Resultado provisional de una transacción que no halló todos los trozos (D45): se confirma o reintenta fuera. */
const INCOMPLETE = Symbol('incomplete');

/**
 * Repite `attempt` mientras devuelva `INCOMPLETE` (otro cliente redujo el contenido a mitad de la lectura: la
 * siguiente vuelta ve la meta nueva). Solo si persiste `READ_ATTEMPTS` veces es un formato roto.
 */
async function untilComplete<T>(attempt: () => Promise<T | typeof INCOMPLETE>): Promise<T> {
  for (let i = 0; i < READ_ATTEMPTS; i++) {
    const r = await attempt();
    if (r !== INCOMPLETE) return r;
  }
  throw new Error(FORMAT_ERROR);
}

/** Lee los trozos de la meta dentro de la transacción `tx` y recompone el contenido; `null` si falta alguno. */
async function readChunks(
  fs: FirestoreModule['fs'],
  tx: Transaction,
  main: DocumentReference,
  n: number,
): Promise<string | null> {
  const snaps = await Promise.all(
    Array.from({ length: n }, (_, i) => tx.get(fs.doc(main, 'chunks', String(i)))),
  );
  return joinChunks(snaps.map((s) => s.data()?.data as string | undefined));
}

/**
 * Contenido completo de un `content/main` ya leído: `data` si cabe en el documento; si no, lee los trozos en
 * una transacción (la revisión devuelta es la de esa lectura, que puede ser posterior a `d`).
 */
async function recompose(
  { fs, db }: FirestoreModule,
  main: DocumentReference,
  d: DocumentData,
): Promise<ContentRecord> {
  if (d.schemaVersion !== 1) throw new Error(FORMAT_ERROR);
  if (typeof d.data === 'string') return toRecord(d, d.data);
  if (chunkCount(d) === null) throw new Error(FORMAT_ERROR);
  return untilComplete(() =>
    fs.runTransaction(db, async (tx) => {
      const meta = (await tx.get(main)).data();
      if (!meta || meta.schemaVersion !== 1) throw new Error(FORMAT_ERROR);
      // Otro editor pudo guardar entre el getDoc y esta transacción: el formato se discrimina de nuevo aquí.
      if (typeof meta.data === 'string') return toRecord(meta, meta.data);
      const n = chunkCount(meta);
      if (!n) throw new Error(FORMAT_ERROR);
      const data = await readChunks(fs, tx, main, n);
      return data === null ? INCOMPLETE : toRecord(meta, data);
    }),
  );
}

export function createContentRepo(load: () => Promise<FirestoreModule>): ContentRepo {
  return {
    async load(id) {
      const m = await load();
      try {
        const main = m.fs.doc(m.db, 'projects', id, 'content', 'main');
        const snap = await m.fs.getDoc(main);
        return snap.exists() ? await recompose(m, main, snap.data()) : null;
      } catch (e) {
        if (isPermissionDenied(e)) return null;
        throw e;
      }
    },

    /**
     * Transacción. Con la revisión esperada escribe `data`; si cambió y hay `merge`, escribe la fusión contra el
     * remoto sobre la revisión actual (el guardado ya no falla por conflicto). Actualiza `projects/{id}.updatedAt`.
     * Si el contenido no cabe en un documento, escribe `chunks` + los trozos y borra los sobrantes de antes.
     */
    async save(id, data, expectedRevision, merge) {
      const { fs, db } = await load();
      const main = fs.doc(db, 'projects', id, 'content', 'main');
      const chunk = (i: number) => fs.doc(main, 'chunks', String(i));
      let read = Number.NaN; // revisión que leyó el último intento
      const attempt = () =>
        fs.runTransaction(db, async (tx) => {
          const snap = await tx.get(main);
          if (!snap.exists()) return { conflict: true as const };
          const meta = snap.data();
          const current = Number(meta.revision);
          read = current;
          const oldChunks = chunkCount(meta) ?? 0;
          let out = data;
          if (current !== expectedRevision) {
            if (!merge) return { conflict: true as const };
            const remote = oldChunks ? await readChunks(fs, tx, main, oldChunks) : meta.data;
            if (remote === null) return INCOMPLETE; // otro cliente redujo el contenido a mitad de la lectura (D45)
            if (typeof remote !== 'string') return { conflict: true as const };
            out = merge(data, remote);
          }
          const parts = splitContent(out);
          const updatedAt = Date.now();
          const revision = current + 1;
          if (parts.length === 1) {
            tx.set(main, { data: out, schemaVersion: 1, revision, updatedAt });
          } else {
            tx.set(main, { schemaVersion: 1, revision, updatedAt, chunks: parts.length });
            parts.forEach((p, i) => tx.set(chunk(i), { data: p }));
          }
          for (let i = parts.length > 1 ? parts.length : 0; i < oldChunks; i++) tx.delete(chunk(i));
          tx.update(fs.doc(db, 'projects', id), { updatedAt });
          return out === data ? { revision } : { revision, merged: out };
        });
      for (let races = 1; ; races++) {
        try {
          return await untilComplete(attempt);
        } catch (e) {
          // D49: si otro cliente confirma entre la lectura y el commit, las reglas («revisión + 1») se evalúan contra
          // su revisión y el commit vuelve como `permission-denied`, que el SDK no reintenta (no es el `aborted` de
          // una precondición). Si la revisión se movió, se repite la transacción, que relee y fusiona; si no, la
          // denegación es real (sin permiso de escritura) y se lanza.
          if (!isPermissionDenied(e) || races >= SAVE_RACES) throw e;
          if (Number((await fs.getDoc(main)).data()?.revision) === read) throw e;
        }
      }
    },

    subscribe(id, cb, onError) {
      let off: (() => void) | null = null;
      let closed = false;
      let seq = 0; // un snapshot nuevo invalida la recomposición en curso del anterior
      load().then(
        (m) => {
          if (closed) return;
          const main = m.fs.doc(m.db, 'projects', id, 'content', 'main');
          off = m.fs.onSnapshot(
            main,
            (snap) => {
              const d = snap.data();
              if (!d || d.schemaVersion !== 1) return;
              const mine = ++seq;
              recompose(m, main, d).then(
                (rec) => {
                  if (!closed && mine === seq) cb(rec);
                },
                (e) => {
                  if (!closed && mine === seq) onError?.(e instanceof Error ? e : new Error(String(e)));
                },
              );
            },
            (e) => onError?.(e),
          );
        },
        (e) => onError?.(e),
      );
      return () => {
        closed = true;
        off?.();
      };
    },
  };
}
