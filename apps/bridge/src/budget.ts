import { BUDGET_LIMIT_FEN } from '../../../packages/contracts/src/application.js';
import { AppError } from '../../../packages/contracts/src/errors.js';

export interface LedgerEntry {
  jobId: string;
  reservedFen: number;
  settledFen: number | null;
  unknown: boolean;
  createdAt: string;
}

export class BudgetLedger {
  readonly limitFen = BUDGET_LIMIT_FEN;
  private readonly entries: LedgerEntry[] = [];

  spentFen(): number {
    return this.entries.reduce((sum, entry) => sum + (entry.settledFen ?? 0), 0);
  }

  reservedFen(): number {
    return this.entries.reduce((sum, entry) => {
      if (entry.settledFen !== null && !entry.unknown) return sum;
      return sum + entry.reservedFen;
    }, 0);
  }

  totalFen(): number { return this.spentFen() + this.reservedFen(); }

  assertCanSpend(worstFen: number | null): number {
    if (worstFen === null) {
      throw new AppError(402, 'COST_UNKNOWN', '无法确定最坏费用，已阻止付费调用。');
    }
    if (this.totalFen() + worstFen > this.limitFen) {
      throw new AppError(402, 'BUDGET_EXCEEDED', '累计支出与预留将超过 30 元上限。');
    }
    return worstFen;
  }

  reserve(jobId: string, fen: number, unknown = false): void {
    this.entries.push({
      jobId, reservedFen: fen, settledFen: unknown ? null : null, unknown,
      createdAt: new Date().toISOString()
    });
  }

  settle(jobId: string, fen: number): void {
    const entry = this.entries.find(item => item.jobId === jobId);
    if (!entry) return;
    entry.settledFen = fen;
    entry.unknown = false;
  }

  markUnknown(jobId: string): void {
    const entry = this.entries.find(item => item.jobId === jobId);
    if (entry) entry.unknown = true;
  }

  snapshot(): { spentFen: number; reservedFen: number; spentAndReservedFen: number; budgetLimitFen: number } {
    return {
      spentFen: this.spentFen(),
      reservedFen: this.reservedFen(),
      spentAndReservedFen: this.totalFen(),
      budgetLimitFen: this.limitFen
    };
  }
}
