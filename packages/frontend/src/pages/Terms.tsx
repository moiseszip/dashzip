import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-12 animate-dash-in">
        <Link to="/">
          <Button variant="ghost" className="mb-6 text-muted-foreground/60 hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        </Link>

        <h1 className="mb-8 text-2xl font-semibold text-foreground">Termos de Uso</h1>

        <div className="prose prose-invert max-w-none space-y-6 text-muted-foreground/60">
          <p><strong>Última atualização:</strong> Novembro de 2026</p>

          <h2 className="text-xl font-semibold text-foreground">1. O que é esta instância</h2>
          <p>Este painel é uma instância do Dash.zip operada pelo responsável pela operação de vendas que convidou você ("Operador"). O Operador contrata a própria infraestrutura (hospedagem, banco de dados e domínio) e licencia o Dash.zip do autor.</p>

          <h2 className="text-xl font-semibold text-foreground">2. Acesso</h2>
          <p>O acesso é pessoal e criado pelo Operador. Você é responsável pela sua senha e pelo segundo fator de autenticação. Avise o Operador se suspeitar de uso indevido.</p>

          <h2 className="text-xl font-semibold text-foreground">3. Uso aceitável</h2>
          <p>Use o painel apenas para a operação do Operador, de acordo com a lei e com os termos das plataformas conectadas (Meta, checkouts e demais serviços).</p>

          <h2 className="text-xl font-semibold text-foreground">4. Dados</h2>
          <p>Os dados exibidos pertencem à operação do Operador e ficam na infraestrutura dele. Veja a Política de Privacidade.</p>

          <h2 className="text-xl font-semibold text-foreground">5. Software</h2>
          <p>O Dash.zip é fornecido ao Operador sob licença comercial, no estado em que se encontra, sem garantia de resultado de campanhas ou vendas.</p>

          <h2 className="text-xl font-semibold text-foreground">6. Contato</h2>
          <p>Dúvidas sobre o acesso ou sobre estes termos devem ser enviadas ao administrador desta instância.</p>
        </div>
      </div>
    </div>
  );
}
