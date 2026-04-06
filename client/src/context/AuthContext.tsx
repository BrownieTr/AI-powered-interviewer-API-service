import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, getToken, setStoredToken } from "../api/client";

export type User = {
  id: string;
  email: string;
  role?: "user" | "admin";
  freeCallsUsed?: number;
  freeCallsLimit?: number;
  createdAt?: number;
};

type AuthState = {
  user: User | null;
  token: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => getToken());
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = getToken();
      if (!t) {
        if (!cancelled) setReady(true);
        return;
      }
      try {
        const me = await api<{
          id: string;
          email: string;
          role: "user" | "admin";
          freeCallsUsed: number;
          freeCallsLimit: number;
          createdAt: number;
        }>("/api/users/me");
        if (!cancelled) {
          setUser({
            id: me.id,
            email: me.email,
            role: me.role,
            freeCallsUsed: me.freeCallsUsed,
            freeCallsLimit: me.freeCallsLimit,
            createdAt: me.createdAt,
          });
          setToken(t);
        }
      } catch {
        if (!cancelled) logout();
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{
      token: string;
      user: {
        id: string;
        email: string;
        role: "user" | "admin";
        freeCallsUsed: number;
        freeCallsLimit: number;
      };
    }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const res = await api<{
      token: string;
      user: {
        id: string;
        email: string;
        role: "user" | "admin";
        freeCallsUsed: number;
        freeCallsLimit: number;
      };
    }>("/api/auth/register", {
      method: "POST",
      body: { email, password },
    });
    setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo(
    () => ({ user, token, ready, login, register, logout }),
    [user, token, ready, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
