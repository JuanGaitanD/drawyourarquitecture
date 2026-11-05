import c4 from '../model/templates/c4-contexto.json';
import eventDriven from '../model/templates/event-driven.json';
import web3 from '../model/templates/web-3-capas.json';
import type { BoardContent } from '../model/board';
import { validateBoardContent } from '../model/validate';
import { remapIds } from './content';

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  /** JSON tal cual; se valida con `validateBoardContent` al instanciarlo. */
  raw: unknown;
}

export const TEMPLATES: readonly BoardTemplate[] = [
  {
    id: 'web-3-capas',
    name: 'Web de 3 capas',
    description:
      'Presentación, lógica de negocio y datos: SPA, API Gateway, servicios, base de datos y caché.',
    raw: web3,
  },
  {
    id: 'c4-contexto',
    name: 'C4 · Contexto',
    description: 'Nivel 1 de C4: personas, el sistema propio y los sistemas externos con los que se integra.',
    raw: c4,
  },
  {
    id: 'event-driven',
    name: 'Event-driven',
    description: 'Productores, bus de eventos, consumidores, almacenes y cola de mensajes fallidos.',
    raw: eventDriven,
  },
];

/** Valida la plantilla y devuelve una copia con ids nuevos (se puede insertar varias veces). */
export function instantiateTemplate(t: BoardTemplate): BoardContent {
  const v = validateBoardContent(t.raw);
  if (!v.ok) throw new Error(`La plantilla «${t.name}» no es válida: ${v.error}`);
  return remapIds(v.value);
}
