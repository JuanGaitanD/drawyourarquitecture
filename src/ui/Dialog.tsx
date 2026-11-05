import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
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
  /** Elemento que recibe el foco al abrir (p. ej. «Cancelar» en un diálogo destructivo). Por defecto, el primero. */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * Devuelve el foco a `target` cuando `open` pasa de true a false. Hace falta cuando el diálogo se abre desde un
 * menú: Radix intenta devolver el foco al ítem del menú, que ya no existe, y el foco caería en `body`.
 */
export function useReturnFocus(open: boolean, target: RefObject<HTMLElement | null>): void {
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !open) target.current?.focus();
    was.current = open;
  }, [open, target]);
}

export function DialogContent({
  title,
  description,
  children,
  footer,
  size = 'md',
  initialFocus,
}: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={styles.overlay} />
      <RadixDialog.Content
        className={`${styles.content} ${styles[size]}`}
        onOpenAutoFocus={
          initialFocus
            ? (e) => {
                e.preventDefault();
                initialFocus.current?.focus();
              }
            : undefined
        }
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
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
