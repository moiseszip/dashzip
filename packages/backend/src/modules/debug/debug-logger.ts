import { ConsoleLogger } from '@nestjs/common';
import { debugContext, DebugLogLine } from './debug-context';

/**
 * O logger da aplicação, que além do console escreve no rastro da requisição
 * em curso. É o "Console" do preview do servidor: o que os processors dos
 * checkouts já logam aparece no painel sem mexer em nenhum deles.
 */
export class DebugLogger extends ConsoleLogger {
  log(message: any, ...rest: any[]) {
    this.capture('log', message, rest);
    super.log(message, ...rest);
  }

  warn(message: any, ...rest: any[]) {
    this.capture('warn', message, rest);
    super.warn(message, ...rest);
  }

  error(message: any, ...rest: any[]) {
    this.capture('error', message, rest);
    super.error(message, ...rest);
  }

  debug(message: any, ...rest: any[]) {
    this.capture('debug', message, rest);
    super.debug(message, ...rest);
  }

  private capture(level: DebugLogLine['level'], message: unknown, rest: unknown[]) {
    const trace = debugContext.getStore();
    if (!trace) return;
    // O último argumento string é o contexto (nome da classe) que o Logger passa.
    const context = typeof rest[rest.length - 1] === 'string' ? (rest[rest.length - 1] as string) : null;
    const text = typeof message === 'string' ? message : safeJson(message);
    trace.log(text, level, context);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
