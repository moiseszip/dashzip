import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefgh.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-teste');

describe('cliente enxuto do Supabase', () => {
  it('usa a mesma chave de sessão do supabase-js (sb-<ref>-auth-token): quem está logado continua logado', async () => {
    const { supabaseStorageKey } = await import('@/integrations/supabase/client');
    expect(supabaseStorageKey('https://abcdefgh.supabase.co')).toBe('sb-abcdefgh-auth-token');
    expect(supabaseStorageKey('https://abcdefgh.supabase.co/')).toBe('sb-abcdefgh-auth-token');
    expect(supabaseStorageKey('http://localhost:54321')).toBe('sb-localhost-auth-token');
  });

  it('expõe auth (login, sessão, MFA) e from() para a leitura de profiles', async () => {
    const { supabase, createIsolatedAuthClient } = await import('@/integrations/supabase/client');
    expect(typeof supabase.auth.signInWithPassword).toBe('function');
    expect(typeof supabase.auth.mfa.challenge).toBe('function');
    expect(typeof supabase.from('profiles').select).toBe('function');
    expect(typeof createIsolatedAuthClient().auth.signInWithPassword).toBe('function');
  });
});
