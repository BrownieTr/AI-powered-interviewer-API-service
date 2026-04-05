const TOKEN_KEY = "ai_interviewer_token";

export const apiBase =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:3001";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type FetchOpts = Omit<RequestInit, "body"> & { body?: unknown };

export async function api<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = getToken();
  const isFormData = opts.body instanceof FormData;
  const requestBody: BodyInit | null | undefined =
    opts.body === undefined
      ? undefined
      : opts.body === null
        ? null
      : isFormData
        ? (opts.body as FormData)
        : JSON.stringify(opts.body);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.body !== undefined && !isFormData ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${apiBase}${path}`, {
    ...opts,
    headers,
    body: requestBody,
  });

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : res.statusText;
    throw new ApiError(msg || "Request failed", res.status, data);
  }

  return data as T;
}
