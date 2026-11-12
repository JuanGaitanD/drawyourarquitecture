import { LogOut, Moon, Settings, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  useTheme,
} from '@/ui';
import { useAuth } from '../hooks';
import { LogoMark } from './Logo';
import styles from './Shell.module.css';

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const dark = resolved === 'dark';
  return (
    <IconButton
      label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      icon={dark ? <Sun size={18} /> : <Moon size={18} />}
      onClick={toggle}
    />
  );
}

export function UserMenu() {
  const { user, signOut } = useAuth();
  const [, navigate] = useLocation();
  if (!user) return null;
  const initial = user.name.trim().charAt(0).toUpperCase() || '?';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={styles.avatarButton} aria-label={`Cuenta de ${user.name}`}>
        {user.photo ? (
          <img className={styles.avatar} src={user.photo} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {initial}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Settings size={16} />} onSelect={() => navigate('/settings')}>
          Ajustes
        </DropdownMenuItem>
        <DropdownMenuItem icon={<LogOut size={16} />} onSelect={() => void signOut()}>
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Marco de las pantallas con sesión (panel): cabecera con marca, tema y cuenta. Los editores llevan la suya. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a href="#contenido" className={styles.skip}>
        Saltar al contenido
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="DYA (Draw your Architecture), ir al panel">
          <LogoMark />
          <span className={styles.wordmark}>DYA</span>
        </Link>
        <div className={styles.actions}>
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>
      <main id="contenido" tabIndex={-1} className={styles.main}>{children}</main>
    </div>
  );
}
