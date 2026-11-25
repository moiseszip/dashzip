import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from './ApprovalCard';

vi.mock('@/lib/api', () => ({ api: {} }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('ApprovalCard', () => {
  it('uma linha por meio, taxa ao lado e "—" sem pedido do meio', () => {
    render(<ApprovalCard points={[
      { label: 'Cartão de crédito', method: 'credit_card', approved: 3, generated: 4, rate: 0.75 },
      { label: 'Cartão de débito', method: 'debit_card', approved: 0, generated: 0, rate: null },
      { label: 'Pix', method: 'pix', approved: 9, generated: 12, rate: 0.75 },
      { label: 'Boleto', method: 'boleto', approved: 0, generated: 2, rate: 0 },
    ]} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('p')?.textContent)).toEqual(['Cartão de crédito', 'Cartão de débito', 'Pix', 'Boleto']);
    expect(rows[0]).toHaveTextContent('3 de 4 pedidos');
    expect(rows[0]).toHaveTextContent('75,0%');
    expect(rows[1]).toHaveTextContent('Sem pedidos no período');
    expect(rows[1]).toHaveTextContent('—');
    expect(rows[3]).toHaveTextContent('0,0%');
    expect(rows[0].getAttribute('title')).toContain('Aprovados ÷ gerados');
  });
});
