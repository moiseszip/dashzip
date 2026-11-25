import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { clearCachedUserData } from '@/lib/workspaceCache';
import { createIsolatedAuthClient, supabase } from '@/integrations/supabase/client';
import { secondFactorState, verifyLoginCode, mfaErrorMessage } from '@/lib/mfa';
import { fetchPasskeyStatus, passkeyErrorMessage, verifyPasskeyLogin, type PreparedAuthentication } from '@/lib/passkeys';
import { MFA_REQUIRED_EVENT } from '@/lib/api';
import { passwordErrorMessage } from '@/lib/password';
import type { User as SupabaseUser, Session } from '@supabase/auth-js';
import { useQueryClient } from '@tanstack/react-query';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  plan: 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited';
  avatar_url?: string;
  createdAt: string;
  active: boolean;
  subscription_end: string | null;
}

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  session: Session | null;
  isLoading: boolean;
  /** Sessão de quem tem 2FA ainda sem o segundo fator (código ou passkey). */
  mfaRequired: boolean;
  /** Quais segundos fatores a conta tem: o login oferece os dois. */
  mfaMethods: { totp: boolean; passkey: boolean };
  login: (email: string, password: string) => Promise<{ success: boolean; isAdmin: boolean; mfaRequired?: boolean }>;
  /** Confere o código do app e sobe a sessão para aal2. */
  verifyMfa: (code: string) => Promise<{ ok: boolean; error?: string }>;
  /** Assina o desafio com a passkey e eleva a sessão no backend. */
  verifyPasskey: (prepared: PreparedAuthentication) => Promise<{ ok: boolean; error?: string }>;
  /** Relê o nível da sessão (depois de ativar ou desativar o 2FA). */
  refreshMfa: () => Promise<void>;
  /** Confere a senha atual num cliente separado e troca pela nova. */
  changePassword: (current: string, next: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  updateUser: (updates: Partial<User>) => Promise<void>;
}

const authContextFallback: AuthContextType = {
  user: null,
  supabaseUser: null,
  session: null,
  isLoading: false,
  mfaRequired: false,
  mfaMethods: { totp: false, passkey: false },
  login: async () => ({ success: false, isAdmin: false }),
  verifyMfa: async () => ({ ok: false }),
  verifyPasskey: async () => ({ ok: false }),
  refreshMfa: async () => {},
  changePassword: async () => ({ ok: false }),
  logout: async () => {},
  resetPassword: async () => false,
  updateUser: async () => {},
};

const AuthContext = createContext<AuthContextType>(authContextFallback);

export function AuthProvider({ children }: { children: ReactNode }) {
  const AUTH_INIT_TIMEOUT_MS = 12000;
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaMethods, setMfaMethods] = useState({ totp: false, passkey: false });
  const queryClient = useQueryClient();

  const checkMfa = async () => {
    try {
      const state = await secondFactorState(supabase.auth, () => fetchPasskeyStatus());
      setMfaRequired(state.required);
      setMfaMethods({ totp: state.totp, passkey: state.passkey });
      return state.required;
    } catch {
      setMfaRequired(false);
      return false;
    }
  };

  /**
   * Monta o User a partir de profiles, caindo na sessao quando a linha nao
   * existe. Recebe o usuario do Auth inteiro, e nao so o id, justamente para
   * ter esse fallback.
   */
  const fetchUserProfile = async (authUser: SupabaseUser): Promise<User | null> => {
    const userId = authUser.id;

    // Identidade derivada so da sessao. E o que o app usa quando profiles
    // ainda nao tem linha para esta pessoa.
    const fromSession = (): User => ({
      id: userId,
      name: (authUser.user_metadata?.name as string) || authUser.email?.split('@')[0] || '',
      email: authUser.email || '',
      role: 'user',
      plan: 'unlimited',
      avatar_url: undefined,
      createdAt: authUser.created_at,
      active: true,
      subscription_end: null,
    });

    try {
      // Nao ha mais plano nem papel: a cobranca e o painel admin sairam do
      // produto, e com eles as tabelas plan_rules e user_roles. Consultar as
      // duas aqui fazia esta funcao devolver null e o login nunca redirecionar.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('name, email, avatar_url, created_at, active')
        .eq('user_id', userId)
        .maybeSingle();

      // Nem erro de consulta nem ausencia de linha podem barrar o login. A
      // identidade real vem do Auth; profiles e um registro de conveniencia.
      // Barrar aqui devolvia a pessoa pro login sem mensagem nenhuma — nao
      // entra e nao explica, que e o pior dos dois mundos.
      if (profileError) {
        console.error('[Auth] Falha ao ler profiles, usando a sessao:', profileError);
        return fromSession();
      }

      if (!profile) {
        console.warn('[Auth] Sem linha em profiles para', userId, '— usando a sessao.');
        return fromSession();
      }

      return {
        id: userId,
        name: profile.name || '',
        email: profile.email || '',
        // Mantidos no tipo porque varias telas os leem. Com um so usuario e
        // sem cobranca, os valores sao constantes.
        role: 'user',
        plan: 'unlimited',
        avatar_url: profile.avatar_url,
        createdAt: profile.created_at,
        active: profile.active ?? true,
        subscription_end: null,
      };
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
      return null;
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Listener for ONGOING auth changes (does NOT control isLoading)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (!isMounted) return;
        setSession(currentSession);
        setSupabaseUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          fetchUserProfile(currentSession.user).then((profile) => {
            if (isMounted) setUser(profile);
          });
          // Fora do callback: chamar o auth dentro dele pode travar o lock do supabase-js.
          window.setTimeout(() => {
            if (isMounted) checkMfa();
          }, 0);
        } else {
          setUser(null);
          setMfaRequired(false);
        }
      }
    );

    // INITIAL load (controls isLoading)
    const initializeAuth = async () => {
      let completed = false;
      const timeoutId = window.setTimeout(() => {
        if (isMounted && !completed) {
          console.warn('[Auth] Session init timeout, liberando UI.');
          setIsLoading(false);
        }
      }, AUTH_INIT_TIMEOUT_MS);

      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!isMounted) return;

        setSession(currentSession);
        setSupabaseUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          const [profile] = await Promise.all([fetchUserProfile(currentSession.user), checkMfa()]);
          if (isMounted) setUser(profile);
        }
      } catch (error) {
        console.error('[Auth] Failed to initialize session:', error);
      } finally {
        completed = true;
        window.clearTimeout(timeoutId);
        if (isMounted) setIsLoading(false);
      }
    };

    initializeAuth();

    // O backend recusou a sessão por falta do segundo fator: relê e volta ao login.
    const onMfaRequired = () => {
      if (isMounted) checkMfa();
    };
    window.addEventListener(MFA_REQUIRED_EVENT, onMfaRequired);

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      window.removeEventListener(MFA_REQUIRED_EVENT, onMfaRequired);
    };
  }, [AUTH_INIT_TIMEOUT_MS]);

  const login = async (email: string, password: string): Promise<{ success: boolean; isAdmin: boolean; mfaRequired?: boolean }> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Login error:', error.message);
        return { success: false, isAdmin: false };
      }

      if (data.user) {
        // Fetch profile and role BEFORE returning so ProtectedRoute sees the user
        const [profile, required] = await Promise.all([fetchUserProfile(data.user), checkMfa()]);
        setUser(profile);
        setSupabaseUser(data.user);
        setSession(data.session);

        const isAdmin = profile?.role === 'admin';
        return { success: true, isAdmin, mfaRequired: required };
      }

      return { success: false, isAdmin: false };
    } catch (error) {
      console.error('Login exception:', error);
      return { success: false, isAdmin: false };
    }
  };

  const verifyMfa = async (code: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await verifyLoginCode(supabase.auth, code);
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      const still = await checkMfa();
      if (still) return { ok: false, error: 'O código foi aceito, mas a sessão não subiu de nível. Tente de novo.' };
      // O que foi pedido com a sessão aal1 levou 401 do backend: busca de novo.
      queryClient.invalidateQueries();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mfaErrorMessage(error) };
    }
  };

  const verifyPasskey = async (prepared: PreparedAuthentication): Promise<{ ok: boolean; error?: string }> => {
    try {
      await verifyPasskeyLogin(prepared);
      const still = await checkMfa();
      if (still) return { ok: false, error: 'A passkey foi aceita, mas a sessão não foi liberada. Tente de novo.' };
      queryClient.invalidateQueries();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: passkeyErrorMessage(error) };
    }
  };

  const refreshMfa = async () => {
    await checkMfa();
  };

  const changePassword = async (current: string, next: string): Promise<{ ok: boolean; error?: string }> => {
    const email = supabaseUser?.email ?? session?.user?.email;
    if (!email) return { ok: false, error: 'Sessão sem e-mail. Saia e entre de novo.' };
    // Reautentica num cliente à parte: entrar de novo no cliente principal
    // trocaria a sessão do painel e derrubaria o aal2 de quem tem 2FA.
    const probe = createIsolatedAuthClient();
    try {
      const { error: signInError } = await probe.auth.signInWithPassword({ email, password: current });
      if (signInError) {
        const wrong = signInError.code === 'invalid_credentials' || /invalid login credentials/i.test(signInError.message);
        return { ok: false, error: wrong ? 'A senha atual está incorreta.' : passwordErrorMessage(signInError) };
      }
      let { error } = await supabase.auth.updateUser({ password: next });
      // "Troca de senha segura" ligada e sessão antiga: a sessão recém-aberta
      // conta como login recente. Só vale sem 2FA (ela é aal1).
      if (error && (error.code === 'reauthentication_needed' || /reauthenticat/i.test(error.message))) {
        const retry = await probe.auth.updateUser({ password: next });
        error = retry.error;
      }
      if (error) return { ok: false, error: passwordErrorMessage(error) };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: passwordErrorMessage(error as { message?: string }) };
    } finally {
      // Encerra só a sessão de conferência; as outras continuam.
      probe.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  };

  const logout = async () => {
    try {
      const { removeSalesPush } = await import('@/lib/salesPush');
      await removeSalesPush().catch(() => undefined);
      await supabase.auth.signOut();
      setUser(null);
      setSupabaseUser(null);
      setSession(null);
      setMfaRequired(false);
      setMfaMethods({ totp: false, passkey: false });
      clearCachedUserData();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const resetPassword = async (email: string): Promise<boolean> => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        console.error('Reset password error:', error.message);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Reset password exception:', error);
      return false;
    }
  };

  const updateUser = async (updates: Partial<User>) => {
    if (!supabaseUser) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          name: updates.name,
          avatar_url: updates.avatar_url,
        })
        .eq('user_id', supabaseUser.id);

      if (error) throw error;

      // Refresh profile
      const profile = await fetchUserProfile(supabaseUser);
      if (profile) {
        setUser(profile);
      }
    } catch (error) {
      console.error('Error updating user:', error);
    }
  };

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        supabaseUser, 
        session, 
        isLoading, 
        mfaRequired,
        mfaMethods,
        login, 
        verifyMfa,
        verifyPasskey,
        refreshMfa,
        changePassword,
        logout, 
        resetPassword, 
        updateUser 
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
