import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';

const sections = [
  ['paineis', 'Painéis'],
  ['instalacao', 'Instalação própria'],
  ['integracoes', 'Tracking e checkouts'],
  ['validacao', 'Validação e publicação'],
  ['manutencao', 'Atualizações e suporte'],
  ['api', 'API e MCP'],
] as const;

const variables = [
  ['SUPABASE_URL', 'URL do projeto Supabase.'],
  ['SUPABASE_ANON_KEY', 'Chave pública usada pelo navegador para autenticação.'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Chave privada usada pelo servidor para gravar vendas e eventos.'],
  ['ADMIN_EMAILS', 'E-mails autorizados a administrar os usuários da instalação.'],
  ['ENCRYPTION_KEY', 'Chave privada para cifrar os tokens armazenados. Configure antes de salvar as integrações.'],
];

export default function Documentation() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:m-3 focus:rounded focus:bg-background focus:p-3"
      >
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link to="/docs" aria-label="Documentação do dash.zip"><Logo /></Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild size="sm" variant="outline"><Link to="/login">Acessar painel</Link></Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-9 px-5 py-9 sm:px-8 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12 lg:py-14">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="Nesta página" className="flex flex-wrap gap-x-4 gap-y-2 border-b border-border pb-5 text-sm text-muted-foreground lg:flex-col lg:gap-1 lg:border-b-0">
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-sm py-1 hover:text-foreground focus-visible:outline focus-visible:outline-2">
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <main id="conteudo" className="min-w-0 max-w-3xl scroll-mt-24 pb-8">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Documentação</h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Instale o dash.zip no seu ambiente e acompanhe visitas, cliques e vendas de cada operação.
          </p>

          <article className="mt-11 space-y-10 text-sm leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-foreground [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:pl-1 [&_section]:scroll-mt-24 [&_strong]:text-foreground">
            <section id="paineis">
              <h2>Painéis</h2>
              <p>
                Um painel representa uma operação, marca ou ecossistema. Uma operação de arquitetura pode
                reunir várias páginas, produtos e checkouts. Cada painel reúne tráfego pago e orgânico, vendas,
                mapa de calor e integrações no mesmo lugar. Em <strong>Configurações › Painéis</strong>, use <strong>Novo painel</strong> quando precisar
                acompanhar outra operação pelo mesmo login.
              </p>
            </section>

            <section id="instalacao">
              <h2>Instalação própria</h2>
              <p>Tenha os arquivos da instalação, um repositório Git, uma conta Vercel, um projeto Supabase e acesso ao DNS.</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>Em um projeto Supabase vazio, execute <code>supabase/schema_completo.sql</code>. Crie o primeiro usuário confirmado e desative o cadastro público.</li>
                <li>Envie os arquivos da instalação a um repositório privado e importe o repositório na Vercel. O <code>vercel.json</code> já configura a publicação do painel e do backend.</li>
                <li>Cadastre as variáveis abaixo na Vercel e faça o deploy. Abra <code>/health</code> e confirme a resposta <code>status: ok</code>.</li>
                <li>Adicione o domínio do painel e o subdomínio de coleta no projeto Vercel. Crie os registros que a Vercel indicar no provedor de DNS e confira HTTPS.</li>
                <li>No Supabase Auth, defina a URL do painel como <strong>Site URL</strong> e permita o mesmo endereço com <code>/reset-password</code> para recuperação de senha.</li>
              </ol>
              <dl className="mt-5 divide-y divide-border overflow-hidden rounded-lg border border-border">
                {variables.map(([name, description]) => (
                  <div key={name} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-4">
                    <dt className="break-all font-mono text-xs text-foreground">{name}</dt><dd>{description}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3">Use <code>.env.example</code> como referência e guarde os valores privados no ambiente do servidor.</p>
            </section>

            <section id="integracoes">
              <h2>Tracking e checkouts</h2>
              <ol className="list-decimal space-y-2 pl-5">
                <li>Em <strong>Integrações</strong>, escolha o checkout e o domínio de coleta. Use um domínio da mesma marca das páginas monitoradas. Várias páginas e produtos podem usar o snippet do mesmo painel.</li>
                <li>Copie o snippet para as páginas de venda. Ele registra a visita e leva o identificador da sessão ao checkout.</li>
                <li>Crie um webhook no checkout com a URL e o segredo da integração. Restrinja os eventos ao tipo de pagamento indicado. Na Wiapy, selecione os produtos e <strong>Pagamento aprovado</strong>. O conector AbacatePay v2 atende à primeira cobrança de assinaturas (<code>externalId</code> no formato <code>produto-monthly|annual-uuid</code>).</li>
                <li>Em <strong>API de Conversões do Meta</strong>, configure o ID do Pixel e o token. <code>PageView</code> e <code>InitiateCheckout</code> partem da página, e <code>Purchase</code> é gerado após a confirmação do pagamento pelo webhook.</li>
              </ol>
            </section>

            <section id="validacao">
              <h2>Validação e publicação</h2>
              <ol className="list-decimal space-y-2 pl-5">
                <li>Abra a página em <strong>Preview e debug</strong> e confira o carregamento do snippet, o <code>PageView</code> e o clique no checkout.</li>
                <li>Valide um pagamento controlado. A venda deve aparecer em <strong>Vendas</strong>, com valor, moeda e sessão vinculada.</li>
                <li>Confirme o <code>Purchase</code> nos Eventos de teste do Meta. Reentregue o webhook para verificar a deduplicação. Remova a configuração de teste ao concluir.</li>
                <li>Faça a troca das tags e integrações anteriores depois de comparar os resultados, para evitar eventos duplicados durante a migração.</li>
              </ol>
            </section>

            <section id="manutencao">
              <h2>Atualizações e suporte</h2>
              <p>
                Faça backup antes de alterações no banco. Em uma instalação existente, aplique as próximas
                migrations na ordem registrada no Git e publique o código correspondente. Para diagnosticar falhas,
                confira <code>/health</code>, o HTTPS do coletor e o histórico de entregas no checkout.
              </p>
            </section>

            <section id="api">
              <h2>API e MCP</h2>
              <p>
                A versão atual recebe dados pelo snippet e pelos webhooks. A API pública para agentes de IA
                e um servidor MCP estão planejados. A documentação vai incluir autenticação, escopos por painel
                e exemplos de integração quando essas interfaces estiverem disponíveis.
              </p>
            </section>
          </article>
        </main>
      </div>
    </div>
  );
}
