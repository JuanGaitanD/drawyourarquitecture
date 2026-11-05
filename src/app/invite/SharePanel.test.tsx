// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AclSnapshot, InviteRepo, MemberJoin } from '@/application/ports';
import type { Invite } from '@/domain/invite';
import type { Role } from '@/domain/project';
import { ToastProvider, TooltipProvider } from '@/ui';
import { SharePanel } from './SharePanel';

// Repo de invitaciones en memoria que cumple el puerto `InviteRepo`, inyectado en lugar de `services` (la
// composición con Firebase). El panel no sabe la diferencia; no hay mocks del SDK.
const world = vi.hoisted(() => {
  const w = {
    invites: [] as Invite[],
    members: {} as Record<string, Role>,
    joins: {} as Record<string, MemberJoin>,
    published: [] as AclSnapshot[],
    failNext: null as null | 'create' | 'revokeAndRemove' | 'publish',
    seq: 0,
  };
  return w;
});

vi.mock('../services', () => {
  const fail = (what: 'create' | 'revokeAndRemove' | 'publish') => {
    if (world.failNext === what) {
      world.failNext = null;
      throw new Error('sin red');
    }
  };
  const inviteRepo: Pick<
    InviteRepo,
    'create' | 'listFor' | 'memberJoins' | 'revoke' | 'revokeAndRemove' | 'aclSnapshot'
  > = {
    async create(projectId, role, createdBy) {
      fail('create');
      const inv: Invite = { token: `tok${++world.seq}`, projectId, role, createdBy, expiresAt: 9e12 };
      world.invites.push(inv);
      return inv;
    },
    async listFor() {
      return [...world.invites];
    },
    async memberJoins() {
      return { ...world.joins };
    },
    async revoke(_p, token) {
      world.invites = world.invites.filter((i) => i.token !== token);
    },
    async revokeAndRemove(_p, token) {
      world.invites = world.invites.filter((i) => i.token !== token);
      fail('revokeAndRemove');
      const gone = Object.keys(world.joins).filter((u) => world.joins[u].token === token);
      for (const u of gone) delete world.members[u];
      return gone;
    },
    async aclSnapshot() {
      return { version: world.seq, members: { ...world.members }, invites: {} };
    },
  };
  return {
    identity: { current: () => ({ uid: 'owner' }) },
    inviteRepo,
    projectRepo: {
      get: async () => ({ members: { ...world.members } }),
      setMember: async (_p: string, uid: string, role: Role | null) => {
        if (role) world.members[uid] = role;
        else delete world.members[uid];
      },
    },
    presenceAcl: {
      publish: async (_room: unknown, snap: AclSnapshot) => {
        fail('publish');
        world.published.push(snap);
        return 'ok';
      },
    },
  };
});

const writeText = vi.fn<(t: string) => Promise<void>>();

function setup() {
  const user = userEvent.setup();
  // user-event instala su propio portapapeles: se sustituye el método para ver qué se copió.
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(
    <TooltipProvider>
      <ToastProvider>
        <SharePanel projectId="p1" />
      </ToastProvider>
    </TooltipProvider>,
  );
  return user;
}

beforeEach(() => {
  Object.assign(world, { invites: [], members: {}, joins: {}, published: [], failNext: null, seq: 0 });
  writeText.mockReset().mockResolvedValue();
});

describe('SharePanel · compartir con personas', () => {
  it('sin invitaciones ni miembros solo dice «Solo tú, por ahora.»', async () => {
    setup();
    expect(await screen.findByText('Solo tú, por ahora.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Invitaciones vigentes' })).toBeNull();
  });

  it('Crear enlace crea la invitación con el rol elegido, copia su URL y la lista', async () => {
    const user = setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rol de la invitación' }), 'viewer');
    await user.click(screen.getByRole('button', { name: 'Crear enlace' }));

    expect(await screen.findByText('Enlace de invitación copiado')).toBeTruthy();
    expect(world.invites).toMatchObject([{ projectId: 'p1', role: 'viewer', createdBy: 'owner' }]);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`${location.origin}/invite/tok1`);
    const list = await screen.findByRole('list', { name: 'Invitaciones vigentes' });
    expect(within(list).getByText(/Solo lectura/)).toBeTruthy();
  });

  it('al crear un enlace publica el acceso vigente en el espejo de presencia', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Crear enlace' }));
    await screen.findByText('Enlace de invitación copiado');
    expect(world.published.length).toBeGreaterThan(0);
  });

  it('si crear el enlace falla avisa y no copia nada', async () => {
    const user = setup();
    world.failNext = 'create';
    await user.click(screen.getByRole('button', { name: 'Crear enlace' }));

    expect(await screen.findByText('No se pudo crear la invitación')).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Invitaciones vigentes' })).toBeNull();
  });

  it('si el portapapeles falla muestra la URL para copiarla a mano', async () => {
    writeText.mockRejectedValue(new Error('denegado'));
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Crear enlace' }));

    expect(await screen.findByText('No se pudo copiar')).toBeTruthy();
    expect(screen.getByText(`${location.origin}/invite/tok1`)).toBeTruthy();
  });

  it('Revocar invitación la cierra y la quita de la lista, sin sacar a nadie', async () => {
    world.invites = [{ token: 'tokA', projectId: 'p1', role: 'editor', createdBy: 'owner', expiresAt: 9e12 }];
    world.members = { guest: 'editor' };
    world.joins = { guest: { name: 'Ana', token: 'tokA' } };
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'Revocar invitación' }));

    await waitFor(() => expect(screen.queryByRole('list', { name: 'Invitaciones vigentes' })).toBeNull());
    expect(world.invites).toEqual([]);
    expect(world.members).toEqual({ guest: 'editor' });
    expect(screen.getByRole('list', { name: 'Miembros' })).toBeTruthy();
  });

  it('Revocar y quitar solo aparece si alguien entró y retira a quienes entraron con ese enlace', async () => {
    world.invites = [
      { token: 'tokA', projectId: 'p1', role: 'editor', createdBy: 'owner', expiresAt: 9e12 },
      { token: 'tokB', projectId: 'p1', role: 'viewer', createdBy: 'owner', expiresAt: 9e12 },
    ];
    world.members = { ana: 'editor', luis: 'viewer' };
    world.joins = { ana: { name: 'Ana', token: 'tokA' }, luis: { name: 'Luis', token: 'tokB' } };
    const user = setup();
    const quitar = await screen.findAllByRole('button', {
      name: 'Revocar y quitar a quienes entraron con este enlace',
    });
    expect(quitar).toHaveLength(2);
    expect(screen.getAllByText('ha entrado 1 persona', { exact: false })).toHaveLength(2);

    await user.click(quitar[0]);

    await waitFor(() => expect(world.members).toEqual({ luis: 'viewer' }));
    expect(world.invites.map((i) => i.token)).toEqual(['tokB']);
    await waitFor(() => expect(screen.queryByText('Ana', { exact: false })).toBeNull());
    expect(screen.getByText('Luis', { exact: false })).toBeTruthy();
  });

  it('si la limpieza de «Revocar y quitar» falla deja un aviso con Reintentar que la completa', async () => {
    world.invites = [{ token: 'tokA', projectId: 'p1', role: 'editor', createdBy: 'owner', expiresAt: 9e12 }];
    world.members = { ana: 'editor' };
    world.joins = { ana: { name: 'Ana', token: 'tokA' } };
    const user = setup();
    world.failNext = 'revokeAndRemove';
    await user.click(
      await screen.findByRole('button', { name: 'Revocar y quitar a quienes entraron con este enlace' }),
    );

    expect(await screen.findByText(/falta quitar a quienes entraron con él/)).toBeTruthy();
    expect(world.members).toEqual({ ana: 'editor' });

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(world.members).toEqual({}));
    await waitFor(() => expect(screen.queryByText(/falta quitar/)).toBeNull());
  });

  it('Quitar a un miembro lo retira y republica el acceso', async () => {
    world.members = { ana: 'editor' };
    world.joins = { ana: { name: 'Ana', token: 'x' } };
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'Quitar a Ana' }));

    await waitFor(() => expect(world.members).toEqual({}));
    expect(await screen.findByText('Solo tú, por ahora.')).toBeTruthy();
    expect(world.published.at(-1)?.members).toEqual({});
  });

  it('si el espejo de presencia no se pudo actualizar avisa y deja reintentarlo', async () => {
    world.failNext = 'publish';
    const user = setup();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No se pudo actualizar el acceso a la presencia');

    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
