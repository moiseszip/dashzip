import { Suspense, lazy, ComponentType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { StreamingModeProvider } from "@/contexts/StreamingModeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/DashboardLayout";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { RouteFallback } from "@/components/RouteFallback";
import { pageImports } from "@/lib/routes";

const RELOAD_KEY = "chunk-reload";

function isChunkLoadError(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? "";
  const name = (error as { name?: string })?.name ?? "";
  return (
    name === "ChunkLoadError" ||
    message.includes("dynamically imported module") ||
    message.includes("module script failed") ||
    message.includes("Loading chunk") ||
    message.includes("Loading CSS chunk") ||
    message.includes("Unable to preload CSS") ||
    message.includes("is not a valid JavaScript MIME type")
  );
}

function lazyWithReload<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    importFn().catch((error) => {
      if (isChunkLoadError(error) && !sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, "1");
        window.location.reload();
        return new Promise(() => {});
      }

      sessionStorage.removeItem(RELOAD_KEY);
      throw error;
    }),
  );
}

// Todas as rotas são lazy: o chunk inicial leva só o shell (providers, menu e
// auth). O menu pré-carrega as telas principais (lib/routes.ts).
const Login = lazyWithReload(pageImports.login);
const Preview = lazyWithReload(pageImports.preview);
const ForgotPassword = lazyWithReload(pageImports.forgotPassword);
const ResetPassword = lazyWithReload(pageImports.resetPassword);
const Live = lazyWithReload(pageImports.live);
const Campaigns = lazyWithReload(pageImports.campaigns);
const Costs = lazyWithReload(pageImports.costs);
const Result = lazyWithReload(pageImports.result);
const TestTracking = lazyWithReload(pageImports.tests);
const Hotjar = lazyWithReload(pageImports.hotjar);
const Rules = lazyWithReload(pageImports.rules);
const Sales = lazyWithReload(pageImports.sales);
const Integrations = lazyWithReload(pageImports.integrations);
const Settings = lazyWithReload(pageImports.settings);
const Terms = lazyWithReload(pageImports.terms);
const Documentation = lazyWithReload(pageImports.docs);
const Privacy = lazyWithReload(pageImports.privacy);
const NotFound = lazyWithReload(pageImports.notFound);

// Clear the reload flag on successful app load
sessionStorage.removeItem(RELOAD_KEY);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="dashzip-theme"
    >
    <AppErrorBoundary>
    <StreamingModeProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <TooltipProvider>
            <Toaster />
            <BrowserRouter>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/finance" replace />} />
                  <Route path="/login" element={<Login />} />
                  {/* Nao ha cadastro publico: as contas nascem em Configuracoes > Usuarios. */}
                  <Route path="/register" element={<Navigate to="/login" replace />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/docs" element={<Documentation />} />
                  <Route path="/privacy" element={<Privacy />} />

                  {/* Telas logadas: layout montado uma vez (AppShell), só o conteúdo troca. */}
                  <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                    <Route path="/preview" element={<Preview />} />
                    <Route path="/live" element={<Live />} />
                    <Route path="/finance" element={<Result />} />
                    <Route path="/campaigns" element={<Navigate to="/campaigns/meta" replace />} />
                    <Route path="/campaigns/meta" element={<Campaigns />} />
                    <Route path="/costs" element={<Costs />} />
                    <Route path="/summary" element={<Navigate to="/finance" replace />} />
                    <Route path="/tests" element={<TestTracking />} />
                    <Route path="/hotjar" element={<Hotjar />} />
                    {/* VSL e Mapa de calor viraram seções da aba Hotjar. */}
                    <Route path="/vsl" element={<Navigate to="/hotjar" replace />} />
                    <Route path="/rules" element={<Rules />} />
                    <Route path="/sales" element={<Sales />} />
                    <Route path="/heatmap" element={<Navigate to="/hotjar" replace />} />
                    <Route path="/integrations" element={<Integrations />} />
                    <Route path="/settings" element={<Settings />} />
                  </Route>

                  {/* Endereços antigos do painel. */}
                  <Route path="/dashboard" element={<Navigate to="/finance" replace />} />
                  <Route path="/tracking" element={<Navigate to="/preview" replace />} />

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </TooltipProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </StreamingModeProvider>
    </AppErrorBoundary>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
