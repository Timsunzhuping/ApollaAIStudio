import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, isMfaRequired, type User, type LoginResult } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Returns the login result — `mfaRequired` means a second factor is needed (no session yet). */
  login: (email: string, password?: string) => Promise<LoginResult>;
  completeMfa: (pendingToken: string, code: string) => Promise<void>;
  loginWithMagicToken: (token: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiError)) throw e; // a 401 just means "not logged in"
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password?: string): Promise<LoginResult> => {
    const result = await api.login(email, password);
    if (!isMfaRequired(result)) setUser(result); // full session; MFA-required means no session yet
    return result;
  };
  const completeMfa = async (pendingToken: string, code: string) => setUser(await api.mfaLogin(pendingToken, code));
  const loginWithMagicToken = async (token: string) => setUser(await api.magicLinkVerify(token));
  const register = async (email: string, password: string) => setUser(await api.register(email, password));
  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, completeMfa, loginWithMagicToken, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
