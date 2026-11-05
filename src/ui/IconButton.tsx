import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import styles from './IconButton.module.css';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Obligatoria: es el `aria-label` y el texto del tooltip. */
  label: string;
  icon: ReactNode;
  shortcut?: string;
  variant?: 'ghost' | 'solid';
  size?: 'sm' | 'md';
  /** Estado de herramienta activa o conmutador. */
  pressed?: boolean;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  icon,
  shortcut,
  variant = 'ghost',
  size = 'md',
  pressed,
  tooltipSide,
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const cls = [styles.button, styles[variant], styles[size], className ?? ''].filter(Boolean).join(' ');
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button ref={ref} type={type} className={cls} aria-label={label} aria-pressed={pressed} {...rest}>
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      </button>
    </Tooltip>
  );
}
