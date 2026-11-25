import { Link } from 'react-router-dom';
import { Box, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { RouteFallback } from '@/components/RouteFallback';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';

/** Aviso de conta sem painel. Enquanto a lista de painéis carrega, mostra o loading. */
export function NoWorkspace() {
  const { loading } = useWorkspaceContext();
  if (loading) return <RouteFallback label="Carregando painéis" />;
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Box className="h-7 w-7 text-accent-readable" />
        </div>
        <h2 className="mb-1 text-lg font-semibold text-foreground">Nenhum painel</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Crie um painel em Configurações para configurar seu snippet, Pixel e checkout.
        </p>
        <Button asChild variant="outline" className="mt-5 gap-2">
          <Link to="/settings?tab=dashboards">
            <Plus />
            Criar painel
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
