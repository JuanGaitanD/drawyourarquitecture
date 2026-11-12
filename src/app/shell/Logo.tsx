/** Marca: tres nodos unidos por conectores, en el color de acento del tema. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="6" fill="var(--accent)" />
      <path
        d="M11 11.5h5.5a3 3 0 0 1 3 3V20"
        stroke="var(--on-accent)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <rect x="6.5" y="8" width="7" height="7" rx="2" fill="var(--on-accent)" />
      <circle cx="19.5" cy="22" r="4" fill="var(--on-accent)" />
      <rect x="21" y="6.5" width="5" height="5" rx="1.5" fill="var(--on-accent)" opacity="0.7" />
      <path
        d="M19.5 14.5V11.5h1.5"
        stroke="var(--on-accent)"
        strokeWidth="1.75"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}
