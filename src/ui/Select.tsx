import { ChevronDown } from 'lucide-react';
import type { Ref, SelectHTMLAttributes } from 'react';
import styles from './Field.module.css';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md';
  ref?: Ref<HTMLSelectElement>;
}

/**
 * `<select>` nativo dibujado con el sistema. El elemento nativo sigue siendo el control (teclado, lector
 * de pantalla y lista del navegador); `className` va al contenedor para poder dimensionarlo.
 */
export function Select({ size = 'md', className, children, ref, ...rest }: SelectProps) {
  const field = [styles.field, styles.select, size === 'sm' ? styles.sm : ''].filter(Boolean).join(' ');
  return (
    <span className={[styles.selectWrap, className ?? ''].filter(Boolean).join(' ')}>
      <select ref={ref} className={field} {...rest}>
        {children}
      </select>
      <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
    </span>
  );
}
