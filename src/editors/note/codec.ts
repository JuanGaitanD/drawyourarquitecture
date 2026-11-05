// Contrato de la nota (plan · «Contratos»). El carril B puede añadir helpers, no cambiar esta forma.
export interface NoteContent {
  schemaVersion: 1;
  elements: readonly unknown[];
  appState: { viewBackgroundColor?: string };
  files: Record<string, { mimeType: string; created: number }>;
}

export const emptyNote = (): NoteContent => ({ schemaVersion: 1, elements: [], appState: {}, files: {} });
