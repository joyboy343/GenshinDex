export const ACCOUNT_SERVERS = ['unknown', 'os_usa', 'os_europe', 'os_asia', 'os_cht'] as const;
export type AccountServer = (typeof ACCOUNT_SERVERS)[number];

export type Account = {
  id: string;
  nickname: string;
  uid: string | null;
  server: AccountServer;
  createdAt: string;
  updatedAt: string;
};

export type CreateAccountInput = {
  nickname: string;
  uid?: string;
  server: AccountServer;
};

export type ApiSuccess<T> = { data: T };
export type ApiFailure = { error: { code: string; message: string } };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseCreateAccountInput(input: unknown): ParseResult<CreateAccountInput> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'Expected a JSON object.' };
  }

  const value = input as Record<string, unknown>;
  if (typeof value.nickname !== 'string' || value.nickname.trim().length < 1 || value.nickname.trim().length > 80) {
    return { ok: false, message: 'nickname must contain 1–80 characters.' };
  }

  let uid: string | undefined;
  if (value.uid !== undefined && value.uid !== null && value.uid !== '') {
    if (typeof value.uid !== 'string' || !/^\d{9,10}$/.test(value.uid)) {
      return { ok: false, message: 'UID must contain 9 or 10 digits.' };
    }
    uid = value.uid;
  }

  const server = value.server ?? 'unknown';
  if (typeof server !== 'string' || !ACCOUNT_SERVERS.includes(server as AccountServer)) {
    return { ok: false, message: 'Unsupported server value.' };
  }

  return {
    ok: true,
    value: { nickname: value.nickname.trim(), ...(uid ? { uid } : {}), server: server as AccountServer },
  };
}
