import type { ReactNode } from 'react';
import type { Swatch } from './palette';
import styles from './controls.module.css';

// Controles pequeños del panel de estilo. Botones con `aria-pressed` dentro de un grupo con nombre.

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.section} role="group" aria-label={title}>
      <p className={styles.title} aria-hidden="true">
        {title}
      </p>
      {children}
    </div>
  );
}

export interface Option<V> {
  value: V;
  label: string;
  icon?: ReactNode;
}

/** Elección única (p. ej. trazado, grosor). `value` indefinido = selección mixta: ninguna marcada. */
export function Segmented<V extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<V>[];
  value: V | undefined;
  onChange: (v: V) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={styles.seg}
          aria-pressed={value === o.value}
          aria-label={o.icon ? o.label : undefined}
          title={o.icon ? o.label : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  );
}

/** Interruptor (p. ej. discontinua, negrita). `pressed` indefinido = mixto: apagado. */
export function Toggle({
  label,
  pressed,
  icon,
  onChange,
}: {
  label: string;
  pressed: boolean | undefined;
  icon?: ReactNode;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={!!pressed}
      onClick={() => onChange(!pressed)}
    >
      {icon ? (
        <span className={styles.toggleIcon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {label}
    </button>
  );
}

const isTransparent = (v: string) => v === 'transparent';

/** Cuadrícula de colores del dibujo. El borde del chip usa tokens; el relleno es el color literal. */
export function ColorGrid({
  label,
  colors,
  value,
  onPick,
  columns = 6,
}: {
  label: string;
  colors: Swatch[];
  value: string | undefined;
  onPick: (value: string) => void;
  columns?: number;
}) {
  return (
    <div
      className={styles.colors}
      role="group"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${columns}, 1.75rem)` }}
    >
      {colors.map((c) => (
        <button
          key={c.name + c.value}
          type="button"
          className={styles.color}
          data-none={isTransparent(c.value) || undefined}
          aria-pressed={value === c.value}
          aria-label={c.name}
          title={c.name}
          onClick={() => onPick(c.value)}
        >
          <span
            className={styles.chip}
            style={isTransparent(c.value) ? undefined : { background: c.value }}
          />
        </button>
      ))}
    </div>
  );
}

/** Muestra del color actual para el botón que abre el popover: disco (relleno) o anillo (borde). */
export function SwatchDot({ color, ring }: { color: string | undefined; ring?: boolean }) {
  const none = color === undefined || isTransparent(color);
  return (
    <span
      className={styles.dot}
      data-ring={ring || undefined}
      data-none={none || undefined}
      data-mixed={color === undefined || undefined}
      style={none ? undefined : ring ? { borderColor: color } : { background: color }}
      aria-hidden="true"
    />
  );
}
