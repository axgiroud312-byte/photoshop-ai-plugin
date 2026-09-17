import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetLedger } from '../apps/bridge/src/budget.js';
import { AppError } from '../packages/contracts/src/errors.js';

test('budget ledger blocks unknown RMB and keeps unknown reserves', () => {
  const ledger = new BudgetLedger();
  assert.throws(() => ledger.assertCanSpend(null), (error: AppError) => error.code === 'COST_UNKNOWN');
  assert.equal(ledger.assertCanSpend(100), 100);
  ledger.reserve('j1', 100);
  ledger.settle('j1', 40);
  assert.equal(ledger.spentFen(), 40);
  ledger.reserve('j2', 80, true);
  ledger.markUnknown('j2');
  assert.equal(ledger.reservedFen(), 80);
  assert.equal(ledger.totalFen(), 120);
  assert.throws(() => ledger.assertCanSpend(3000), (error: AppError) => error.code === 'BUDGET_EXCEEDED');
});
