import { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Dentro do layout: só a área do conteúdo, com o menu ainda disponível. */
  inline?: boolean;
  /** Ao mudar (ex.: o caminho da tela), limpa o erro e tenta renderizar de novo. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  errorMessage?: string;
}

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erro inesperado ao carregar a aplicação.',
    };
  }

  public componentDidUpdate(previous: Props) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) this.setState({ hasError: false, errorMessage: undefined });
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className={this.props.inline ? 'flex justify-center py-16' : 'flex min-h-screen items-center justify-center bg-background px-6'}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
            <h1 className="text-base font-semibold text-foreground">Erro ao carregar a tela</h1>
            <p className="mt-2 text-sm text-muted-foreground">{this.state.errorMessage}</p>
            <Button className="mt-4" onClick={this.handleReload}>
              Tentar novamente
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
