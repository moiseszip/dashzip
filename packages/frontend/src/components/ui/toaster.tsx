import type * as React from "react";
import { useToast } from "@/hooks/use-toast";
import { useMask } from "@/contexts/StreamingModeContext";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();
  // Modo streaming: erro da API ou da Meta pode citar nome de campanha, e-mail ou URL.
  const { scrub } = useMask();
  const clean = (node: React.ReactNode) => (typeof node === "string" ? scrub(node) : node);

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{clean(title)}</ToastTitle>}
              {description && <ToastDescription>{clean(description)}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
