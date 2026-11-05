import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Dialog.module.css';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export interface DialogContentProps {
  /** Obligatorio: Radix lo usa como nombre accesible del diálogo. */
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Botones de acción alineados a la derecha (p. ej. Cancelar y Borrar). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function DialogContent({ title, description, children, footer, size = 'md' }: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={styles.overlay} />
      <RadixDialog.Content className={`${styles.content} ${styles[size]}`} {...(description ? {} : { 'aria-describedby': undefined })}>
        <header className={styles.header}>
          <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
          <RadixDialog.Close className={styles.close} aria-label="Cerrar">
            <X size={18} aria-hidden="true" />
          </RadixDialog.Close>
        </header>
        {description ? (
          <RadixDialog.Description className={styles.description}>{description}</RadixDialog.Description>
        ) : null}
        {children ? <div className={styles.body}>{children}</div> : null}
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
