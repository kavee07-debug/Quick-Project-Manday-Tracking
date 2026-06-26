// Thin fetch wrapper. Reads the JWT from localStorage and attaches it to every call.
// Base path is /api/v1 (Vite proxies /api -> backend on :4207).

const BASE = '/api/v1';
const TOKEN_KEY = 'qtm.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Raised when the token is missing/expired so the app can redirect to login.
export class UnauthorizedError extends ApiError {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
    throw new UnauthorizedError(401, 'Session expired. Please sign in again.');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) message = data.message;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Downloads a file (e.g. xlsx export) with the JWT attached, then triggers a browser save.
async function download(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeader() });
  if (res.status === 401) {
    setToken(null);
    throw new UnauthorizedError(401, 'Session expired. Please sign in again.');
  }
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Uploads a single file as multipart/form-data (field name "file").
async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: authHeader(), body: form });

  if (res.status === 401) {
    setToken(null);
    throw new UnauthorizedError(401, 'Session expired. Please sign in again.');
  }
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) message = data.message;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: (path: string) => request<void>('DELETE', path),
  download,
  upload,
};
