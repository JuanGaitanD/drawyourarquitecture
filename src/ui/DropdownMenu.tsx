import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, ReactNode } from 'react';
import styles from './DropdownMenu.module.css';

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;
export const DropdownMenuSub = RadixMenu.Sub;

export function DropdownMenuContent({ className, ...rest }: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        sideOffset={6}
        collisionPadding={8}
        className={[styles.content, className].filter(Boolean).join(' ')}
        {...rest}
      />
    </RadixMenu.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof RadixMenu.Item> {
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
}

export function DropdownMenuItem({ icon, shortcut, danger, children, className, ...rest }: DropdownMenuItemProps) {
  const cls = [styles.item, danger ? styles.danger : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <RadixMenu.Item className={cls} {...rest}>
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      <span className={styles.label}>{children}</span>
      {shortcut ? <kbd className={styles.kbd}>{shortcut}</kbd> : null}
    </RadixMenu.Item>
  );
}

export function DropdownMenuSeparator() {
  return <RadixMenu.Separator className={styles.separator} />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <RadixMenu.Label className={styles.menuLabel}>{children}</RadixMenu.Label>;
}
