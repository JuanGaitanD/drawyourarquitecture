import { describe, expect, it } from 'vitest';
import type { Project } from '@/domain/project';
import type { ContentRepo, FileStore, Identity, ProjectRepo } from './ports';
import { createProjectUseCases } from './projects';

function setup(opts: { signedIn?: boolean; failUpload?: boolean } = {}) {
  const log: string[] = [];
  const projects = new Map<string, Project>();
  const contents = new Map<string, string>();
  const files = new Map<string, Map<string, Blob>>();
  let n = 0;
  files.set(
    'src',
    new Map([
      ['f1', new Blob(['a'])],
      ['f2', new Blob(['b'])],
    ]),
  );
  projects.set('src', {
    id: 'src',
    ownerId: 'u',
    type: 'board',
    title: 'Mi board',
    isPublic: true,
    createdAt: 1,
    updatedAt: 1,
  });
  contents.set('src', '{"orig":true}');

  const projectRepo: ProjectRepo = {
    listMine: () => () => undefined,
    listShared: () => () => undefined,
    setMember: async () => undefined,
    get: async (id) => projects.get(id) ?? null,
    async create(p, initialData) {
      const id = `new${++n}`;
      projects.set(id, { ...p, id });
      contents.set(id, initialData);
      log.push(`create:${id}`);
      return id;
    },
    update: async () => undefined,
    async remove(id) {
      projects.delete(id);
      contents.delete(id);
      log.push(`remove:${id}`);
    },
  };
  const contentRepo: ContentRepo = {
    load: async (id) =>
      contents.has(id) ? { data: contents.get(id)!, schemaVersion: 1, revision: 0, updatedAt: 1 } : null,
    async save(id, data) {
      contents.set(id, data);
      log.push(`content:${id}`);
      return { revision: 1 };
    },
    subscribe: () => () => undefined,
  };
  const fileStore: FileStore = {
    async upload(pid, fid, blob) {
      if (opts.failUpload) throw new Error('sin red');
      if (!files.has(pid)) files.set(pid, new Map());
      files.get(pid)!.set(fid, blob);
      log.push(`upload:${pid}/${fid}`);
    },
    load: async (pid, fid) => files.get(pid)!.get(fid)!,
    list: async (pid) => [...(files.get(pid)?.keys() ?? [])],
    async remove(pid, fid) {
      files.get(pid)?.delete(fid);
      log.push(`rmfile:${pid}/${fid}`);
    },
  };
  const identity: Identity = {
    current: () => (opts.signedIn === false ? null : { uid: 'u', name: 'U' }),
    onChange: () => () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  const uc = createProjectUseCases({
    projects: projectRepo,
    content: contentRepo,
    files: fileStore,
    identity,
    emptyContent: (t) => `{"empty":"${t}"}`,
    now: () => 99,
  });
  return { uc, log, projects, contents };
}

describe('casos de uso de proyectos', () => {
  it('createProject crea privado, con el contenido inicial del tipo y título normalizado', async () => {
    const { uc, projects, contents } = setup();
    const id = await uc.createProject('note', '  ');
    expect(projects.get(id)).toMatchObject({
      ownerId: 'u',
      type: 'note',
      title: 'Sin título',
      isPublic: false,
      createdAt: 99,
    });
    expect(contents.get(id)).toBe('{"empty":"note"}');
  });

  it('createProject exige sesión', async () => {
    const { uc } = setup({ signedIn: false });
    await expect(uc.createProject('board')).rejects.toThrow('sesión');
  });

  it('duplicateProject copia los archivos y escribe el contenido al final', async () => {
    const { uc, log, contents } = setup();
    const id = await uc.duplicateProject('src');
    expect(log).toEqual([`create:${id}`, `upload:${id}/f1`, `upload:${id}/f2`, `content:${id}`]);
    expect(contents.get(id)).toBe('{"orig":true}');
  });

  it('deleteProject borra archivos y luego el proyecto', async () => {
    const { uc, log } = setup();
    await uc.deleteProject('src');
    expect(log).toEqual(['rmfile:src/f1', 'rmfile:src/f2', 'remove:src']);
  });

  it('saveAsCopy crea un proyecto nuevo con los datos locales', async () => {
    const { uc, projects, contents } = setup();
    const id = await uc.saveAsCopy('src', '{"local":1}');
    expect(projects.get(id)?.title).toBe('Mi board (copia)');
    expect(contents.get(id)).toBe('{"local":1}');
  });

  it('saveAsCopy copia los archivos del origen antes de escribir el contenido', async () => {
    const { uc, log } = setup();
    const id = await uc.saveAsCopy('src', '{"local":1}');
    expect(log).toEqual([`create:${id}`, `upload:${id}/f1`, `upload:${id}/f2`, `content:${id}`]);
  });

  it('saveAsCopy borra la copia incompleta si falla al copiar un archivo', async () => {
    const { uc, log, projects } = setup({ failUpload: true });
    await expect(uc.saveAsCopy('src', '{"local":1}')).rejects.toThrow('sin red');
    expect(log).toContain('remove:new1');
    expect(projects.has('new1')).toBe(false);
  });
});
