import type { Role } from './project';

export interface Invite {
  token: string;
  projectId: string;
  role: Role;
  createdBy: string;
  expiresAt: number;
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Token de invitación: 24 bytes aleatorios en base64url (32 caracteres). Es el secreto del enlace. */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export const isExpired = (i: Pick<Invite, 'expiresAt'>, now = Date.now()) => i.expiresAt <= now;
