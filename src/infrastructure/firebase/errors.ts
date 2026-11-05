export const isPermissionDenied = (e: unknown) =>
  (e as { code?: string } | null)?.code === 'permission-denied';
