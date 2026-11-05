import type { DocumentData, DocumentReference, Transaction } from 'firebase/firestore';
import { chunkCount, joinContent, splitContent } from '@/application/contentChunks';
import type { ContentRecord, ContentRepo } from '@/application/ports';
import { loadFirestore, type FirestoreModule } from './firestore';
import { isPermissionDenied } from './projects';

// Contenido de un proyecto (D17):
//   projects/{id}/content/main                = { schemaVersion, revision, updatedAt, data }     (cabe en un documento)
//   projects/{id}/content/main                = { schemaVersion, revision, updatedAt, chunks: n } (n ≥ 2)
//   projects/{id}/content/main/chunks/{i}     = { data: string }                                  (≤ 900 000 bytes)
// Guardar escribe meta y trozos en la misma transacción (con la revisión esperada intacta); leer un contenido
// troceado también va en transacción para no mezclar trozos de dos revisiones. Un límite de una transacción de
// Firestore son 500 escrituras y ~10 MiB: con ≤ 12 trozos y 8 MiB de tope sobra.

const FORMAT_ERROR = 'El contenido guardado tiene un formato desconocido.';

function toRecord(d: DocumentData, data: string): ContentRecord {
  return {
    data,
    schemaVersion: 1,
    revision: Number(d.revision) || 0,
    updatedAt: Number(d.updatedAt) || 0,
  };
}

/** Lee los trozos de `meta` dentro de la transacción `tx` y recompone el contenido. */
async function readChunks(
  fs: FirestoreModule['fs'],
  tx: Transaction,
  main: DocumentReference,
  n: number,
): Promise<string> {
  const snaps = await Promise.all(
    Array.from({ length: n }, (_, i) => tx.get(fs.doc(main, 'chunks', String(i)))),
  );
  return joinContent(
    snaps.map((s) => {
      const part = s.data()?.data;
      if (typeof part !== 'string') throw new Error('Faltan trozos del contenido.');
      return part;
    }),
  );
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
  return fs.runTransaction(db, async (tx) => {
    const meta = (await tx.get(main)).data();
    const n = meta && chunkCount(meta);
    if (!meta || meta.schemaVersion !== 1 || !n) throw new Error(FORMAT_ERROR);
    return toRecord(meta, await readChunks(fs, tx, main, n));
  });
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
      return fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(main);
        if (!snap.exists()) return { conflict: true as const };
        const meta = snap.data();
        const current = Number(meta.revision);
        const oldChunks = chunkCount(meta) ?? 0;
        let out = data;
        if (current !== expectedRevision) {
          if (!merge) return { conflict: true as const };
          const remote = oldChunks ? await readChunks(fs, tx, main, oldChunks) : meta.data;
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

export const contentRepo: ContentRepo = createContentRepo(loadFirestore);
