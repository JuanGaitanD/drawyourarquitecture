const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Texto de atajo para tooltips y menús: `kbd('D', { mod: true })` → «Ctrl+D» o «⌘D». */
export function kbd(key: string, o: { mod?: boolean; shift?: boolean } = {}): string {
  const mod = o.mod ? (isMac ? '⌘' : 'Ctrl+') : '';
  const shift = o.shift ? (isMac ? '⇧' : 'Shift+') : '';
  return `${mod}${shift}${key}`;
}
