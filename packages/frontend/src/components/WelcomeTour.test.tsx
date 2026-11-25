import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { WelcomeTour, TOUR_STEPS, restartWelcomeTour } from './WelcomeTour';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname}{search}</p>;
}
const renderTour = () => render(<MemoryRouter initialEntries={['/finance']}><WelcomeTour /><Where /></MemoryRouter>);

describe('WelcomeTour', () => {
  beforeEach(() => localStorage.clear());

  it('abre no primeiro acesso, percorre as seções e não volta depois de concluído', () => {
    const { unmount } = renderTour();
    expect(screen.getByText('Boas-vindas ao Dash.zip')).toBeTruthy();
    for (let i = 1; i < TOUR_STEPS.length; i++) fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Por onde começar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    expect(localStorage.getItem('dashzip:tour-done:u1')).toBe('1');
    unmount();
    renderTour();
    expect(screen.queryByText('Boas-vindas ao Dash.zip')).toBeNull();
  });

  it('avançar e voltar abrem a tela da seção da etapa', () => {
    renderTour();
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByTestId('where').textContent).toBe('/settings?tab=dashboards');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByTestId('where').textContent).toBe('/finance');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByTestId('where').textContent).toBe('/campaigns/meta');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByTestId('where').textContent).toBe('/finance');
  });

  it('Pular encerra e "Rever tutorial" abre de novo do começo', () => {
    renderTour();
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pular' }));
    expect(screen.queryByText('Painéis')).toBeNull();
    act(() => restartWelcomeTour());
    expect(screen.getByText('Boas-vindas ao Dash.zip')).toBeTruthy();
  });
});
