import { createPortal } from 'react-dom';

/** Overlay de carregamento inicial de rota, sessão ou dados da tela. */
export function RouteFallback({ label = 'Carregando tela' }: { label?: string }) {
  return createPortal(
    <div
      className="animate-fallback-in fixed inset-0 z-[100] grid place-items-center bg-background/80 backdrop-blur-md"
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden="true"
      />
    </div>,
    document.body,
  );
}
