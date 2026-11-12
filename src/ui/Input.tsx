import type { InputHTMLAttributes, Ref } from 'react';
import styles from './Field.module.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md';
  /** Datos (URL, código): tipografía monoespaciada. */
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** Campo de texto del sistema: un `<input>` nativo con su aspecto; pasa todas las props y la `ref`. */
export function Input({ size = 'md', mono = false, className, ref, ...rest }: InputProps) {
  const cls = [styles.field, size === 'sm' ? styles.sm : '', mono ? styles.mono : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <input ref={ref} className={cls} {...rest} />;
}
