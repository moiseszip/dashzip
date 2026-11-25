import { AuthClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. ' +
    'Copy .env.example to .env and fill in the values.',
  );
}

type AuthOptions = ConstructorParameters<typeof AuthClient>[0];

/**
 * O navegador só usa o Auth do Supabase (login, sessão, 2FA) e uma leitura de
 * `profiles`. Em vez do `createClient` do supabase-js, que traz junto Realtime,
 * Storage e Functions (~90 kB no chunk inicial), montamos só as duas peças que
 * ele mesmo usa por dentro: AuthClient (@supabase/auth-js) e PostgrestClient.
 *
 * As opções e cabeçalhos repetem os do supabase-js 2.x (`_initSupabaseAuthClient`
 * e `fetchWithAuth`), inclusive a chave do localStorage `sb-<ref>-auth-token`:
 * quem já está logado continua logado depois da troca.
 */
export function supabaseStorageKey(url: string) {
  const base = new URL(url.endsWith('/') ? url : `${url}/`);
  return `sb-${base.hostname.split('.')[0]}-auth-token`;
}

function createSlimClient(url: string, key: string, auth: Partial<AuthOptions>) {
  const base = new URL(url.endsWith('/') ? url : `${url}/`);
  const legacyKey = !key.startsWith('sb_publishable_');
  const authHeaders: Record<string, string> = { apikey: key, 'X-Client-Info': 'dashzip-web' };
  if (legacyKey) authHeaders.Authorization = `Bearer ${key}`;
  const authClient = new AuthClient({
    url: new URL('auth/v1', base).href,
    headers: authHeaders,
    storageKey: supabaseStorageKey(url),
    detectSessionInUrl: true,
    flowType: 'implicit',
    ...auth,
  });

  // A chave publicável vai no apikey. O Bearer leva o JWT da sessão ou a chave anon legada.
  const authedFetch: typeof fetch = async (input, init) => {
    const { data } = await authClient.getSession();
    const headers = new Headers(init?.headers);
    if (!headers.has('apikey')) headers.set('apikey', key);
    const token = data.session?.access_token ?? (legacyKey ? key : undefined);
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  const rest = new PostgrestClient(new URL('rest/v1', base).href, { fetch: authedFetch });

  return {
    auth: authClient,
    from: (relation: string) => rest.from(relation),
  };
}

/**
 * Supabase client — used ONLY for authentication (login, signup, session).
 * All business data goes through the backend API via src/lib/api.ts.
 */
export const supabase = createSlimClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  storage: localStorage,
  persistSession: true,
  autoRefreshToken: true,
});

/**
 * Cliente descartável, sem sessão salva, para conferir a senha atual na troca
 * de senha sem mexer na sessão do painel (que pode estar em aal2).
 */
export function createIsolatedAuthClient() {
  const memory = new Map<string, string>();
  return createSlimClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    storageKey: 'dashzip-reauth',
    storage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    },
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
}
