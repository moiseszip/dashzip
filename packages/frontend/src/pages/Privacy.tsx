import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-12 animate-dash-in">
        <Link to="/">
          <Button variant="ghost" className="mb-6 text-muted-foreground/60 hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        </Link>

        <h1 className="mb-8 text-2xl font-semibold text-foreground">Política de Privacidade</h1>

        <div className="prose prose-invert max-w-none space-y-6 text-muted-foreground/60">
          <p><strong>Última atualização:</strong> Novembro de 2026</p>
          <p>Esta política segue a Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018).</p>

          <h2 className="text-xl font-semibold text-foreground">1. Quem trata os dados</h2>
          <p>O controlador dos dados desta instância é o Operador que a mantém. Os dados ficam no banco de dados e na hospedagem contratados por ele.</p>

          <h2 className="text-xl font-semibold text-foreground">2. Dados de usuários do painel</h2>
          <p>Nome, e-mail, registros de acesso e preferências, usados para autenticar, proteger a conta e lembrar suas configurações.</p>

          <h2 className="text-xl font-semibold text-foreground">3. Dados de visitantes e compradores</h2>
          <p>O rastreio coleta, nas páginas de venda do Operador, visitas, origem (UTMs), identificadores de anúncio e cliques no checkout. Os checkouts enviam os dados dos pedidos. Esses dados servem para atribuir vendas às campanhas e enviar eventos à API de Conversões do Meta, com dados pessoais enviados em hash.</p>

          <h2 className="text-xl font-semibold text-foreground">4. Do Not Track</h2>
          <p>Visitantes com o Do Not Track ligado no navegador não são rastreados.</p>

          <h2 className="text-xl font-semibold text-foreground">5. Compartilhamento</h2>
          <p>Os dados são compartilhados apenas com os serviços conectados pelo Operador (Meta, checkouts, hospedagem e banco de dados), para as finalidades acima.</p>

          <h2 className="text-xl font-semibold text-foreground">6. Seus direitos (LGPD)</h2>
          <p>Acesso, correção, exclusão, portabilidade e revogação de consentimento podem ser solicitados ao Operador, controlador dos dados.</p>

          <h2 className="text-xl font-semibold text-foreground">7. Contato</h2>
          <p>Fale com o administrador desta instância para exercer seus direitos ou tirar dúvidas.</p>
        </div>
      </div>
    </div>
  );
}
