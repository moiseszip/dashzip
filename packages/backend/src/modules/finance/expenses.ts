import { roundMoney } from './finance-totals';

/**
 * Despesas da operação (docs/features/23-fees-expenses). Avulsa conta na
 * data; recorrente conta todo mês no `recurringDay`, de `startDate` até
 * `endDate` (ou sem fim).
 */

export const EXPENSE_CATEGORIES = ['ads', 'tools', 'team', 'accounting', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  description: string;
  category: ExpenseCategory;
  amountBRL: number;
  kind: 'single' | 'recurring';
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  recurringDay: number | null;
}

export interface ExpenseOccurrence {
  expenseId: string;
  date: string;
  description: string;
  category: ExpenseCategory;
  amountBRL: number;
}

export interface ExpenseRow {
  id: string;
  description: string;
  category: ExpenseCategory;
  amount_brl: number | string;
  kind: 'single' | 'recurring';
  date: string | null;
  start_date: string | null;
  end_date: string | null;
  recurring_day: number | null;
}

export function expenseFromRow(row: ExpenseRow): Expense {
  return {
    id: row.id, description: row.description, category: row.category, amountBRL: Number(row.amount_brl),
    kind: row.kind, date: row.date, startDate: row.start_date, endDate: row.end_date, recurringDay: row.recurring_day,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Ocorrências dentro de [since, until] (dias YYYY-MM-DD), ordenadas por data. */
export function expenseOccurrences(expenses: Expense[], since: string, until: string): ExpenseOccurrence[] {
  const result: ExpenseOccurrence[] = [];
  for (const expense of expenses) {
    const base = { expenseId: expense.id, description: expense.description, category: expense.category, amountBRL: expense.amountBRL };
    if (expense.kind === 'single') {
      if (expense.date && expense.date >= since && expense.date <= until) result.push({ ...base, date: expense.date });
      continue;
    }
    if (!expense.startDate || !expense.recurringDay) continue;
    const from = expense.startDate > since ? expense.startDate : since;
    const to = expense.endDate && expense.endDate < until ? expense.endDate : until;
    if (from > to) continue;
    let year = Number(from.slice(0, 4));
    let month = Number(from.slice(5, 7));
    for (let guard = 0; guard < 240; guard++) {
      const day = `${year}-${pad(month)}-${pad(expense.recurringDay)}`;
      if (day > to) break;
      if (day >= from) result.push({ ...base, date: day });
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));
}

export function sumOccurrences(occurrences: ExpenseOccurrence[]) {
  return roundMoney(occurrences.reduce((sum, item) => sum + item.amountBRL, 0));
}
