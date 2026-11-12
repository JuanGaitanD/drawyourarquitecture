// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

describe('Select', () => {
  it('conserva el <select> nativo: nombre accesible, valor y onChange', async () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Rol de la invitación" value="editor" onChange={onChange}>
        <option value="editor">Puede editar</option>
        <option value="viewer">Solo lectura</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Rol de la invitación' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveProperty('value', 'editor');
    await userEvent.selectOptions(select, 'viewer');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
