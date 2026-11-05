import { Stub } from '@/ui/Stub';
import { useAuth } from '../hooks';
import { Shell } from '../shell/Shell';

// STUB de T0. Lo sustituye el carril A (app/dashboard/**): «Nuevo», grilla de proyectos, tabs, búsqueda,
// menú de tarjeta y estados vacío, cargando y error. Debe seguir exportando `Dashboard`.
export function Dashboard() {
  const { user } = useAuth();
  return (
    <Shell>
      <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-4)' }}>
        Hola{user ? `, ${user.name.split(' ')[0]}` : ''}
      </h1>
      <Stub name="Dashboard" lane="A" />
    </Shell>
  );
}
