import type { Ref, TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: 'sm' | 'md';
  ref?: Ref<HTMLTextAreaElement>;
}

/** Área de texto del sistema (monoespaciada: se usa para código y datos); pasa todas las props y la `ref`. */
export function Textarea({ size = 'md', className, ref, ...rest }: TextareaProps) {
  const cls = [styles.field, size === 'sm' ? styles.sm : '', className ?? ''].filter(Boolean).join(' ');
  return <textarea ref={ref} className={cls} {...rest} />;
}
