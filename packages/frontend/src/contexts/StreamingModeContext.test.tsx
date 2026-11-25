import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Masked } from '@/components/Masked';
import { StreamingModeProvider, useMask } from './StreamingModeContext';

function Probe() {
  const { enabled, toggle, mask, maskUtm, scrub } = useMask();
  return (
    <div>
      <button type="button" onClick={toggle}>alternar</button>
      <p data-testid="state">{enabled ? 'on' : 'off'}</p>
      <p data-testid="campaign">{mask('campaign', 'Kit Arch Frio')}</p>
      <p data-testid="utm">{maskUtm('utm_campaign', 'Kit Arch Frio|1202568')}</p>
      <p data-testid="source">{maskUtm('utm_source', 'FB')}</p>
      <p data-testid="scrub">{scrub('erro em Kit Arch Frio')}</p>
      <p data-testid="email"><Masked kind="email" value="cliente@exemplo.com" /></p>
    </div>
  );
}

describe('StreamingModeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('desligado devolve o valor real', () => {
    render(<StreamingModeProvider><Probe /></StreamingModeProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('off');
    expect(screen.getByTestId('campaign')).toHaveTextContent('Kit Arch Frio');
    expect(screen.getByTestId('utm')).toHaveTextContent('Kit Arch Frio|1202568');
    expect(screen.getByTestId('email')).toHaveTextContent('cliente@exemplo.com');
  });

  it('ligado mascara, a UTM ganha o apelido da campanha e o estado fica salvo', () => {
    render(<StreamingModeProvider><Probe /></StreamingModeProvider>);
    fireEvent.click(screen.getByText('alternar'));
    expect(screen.getByTestId('state')).toHaveTextContent('on');
    expect(screen.getByTestId('campaign')).toHaveTextContent('Campanha 1');
    expect(screen.getByTestId('utm')).toHaveTextContent('Campanha 1');
    expect(screen.getByTestId('source')).toHaveTextContent('FB');
    expect(screen.getByTestId('scrub')).toHaveTextContent('erro em Campanha 1');
    expect(screen.getByTestId('email')).toHaveTextContent('•••••');
    expect(document.body.innerHTML).not.toContain('cliente@exemplo.com');
    expect(document.body.innerHTML).not.toContain('Kit Arch');
    expect(localStorage.getItem('dashzip:streaming-mode')).toBe('1');
    expect(document.documentElement.hasAttribute('data-streaming')).toBe(true);
  });

  it('lê o estado salvo e alterna pelo atalho Alt+Shift+S', () => {
    localStorage.setItem('dashzip:streaming-mode', '1');
    render(<StreamingModeProvider><Probe /></StreamingModeProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('on');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', altKey: true, shiftKey: true }));
    });
    expect(screen.getByTestId('state')).toHaveTextContent('off');
  });
});
