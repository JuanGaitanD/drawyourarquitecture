import type * as FirestoreSdk from 'firebase/firestore';

// Aparte de `firestore.ts` (que lee `import.meta.env`) para que el servidor MCP pueda importar el tipo.
export type FirestoreModule = { fs: typeof FirestoreSdk; db: FirestoreSdk.Firestore };
