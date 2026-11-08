import { describe, expect, it } from 'vitest';
import { createRemoteInbox } from './remoteInbox';

describe('createRemoteInbox', () => {
  it('retiene el registro más reciente mientras el lienzo no está listo y lo entrega al estarlo', () => {
    const inbox = createRemoteInbox<{ revision: number }>();
    const applied: number[] = [];
    const apply = (r: { revision: number }) => applied.push(r.revision);
    inbox.push({ revision: 1 }, false, apply);
    inbox.push({ revision: 3 }, false, apply);
    inbox.push({ revision: 2 }, false, apply);
    expect(applied).toEqual([]);
    inbox.flush(apply);
    expect(applied).toEqual([3]);
    inbox.flush(apply);
    expect(applied).toEqual([3]);
  });

  it('con el lienzo listo aplica de inmediato', () => {
    const inbox = createRemoteInbox<{ revision: number }>();
    const applied: number[] = [];
    inbox.push({ revision: 5 }, true, (r) => applied.push(r.revision));
    expect(applied).toEqual([5]);
  });
});
