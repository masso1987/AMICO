import { Global, Injectable, Module } from '@nestjs/common';
import type { Tx } from '../prisma/prisma.service';
import type { LedgerBook } from '../generated/prisma/client';
import type { PostingLine } from './postings';

@Injectable()
export class LedgerService {
  /**
   * Posts a balanced journal. Lines are validated by the posting builders and,
   * independently, by the database's deferred balance trigger.
   */
  async post(
    tx: Tx,
    args: { book: LedgerBook; kind: string; transactionId?: string; memo: string; lines: PostingLine[]; createdById?: string | null; reversalOfId?: string },
  ) {
    const accounts = await tx.ledgerAccount.findMany({ where: { book: args.book, code: { in: args.lines.map((l) => l.account) } } });
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    for (const l of args.lines) if (!byCode.has(l.account)) throw new Error(`Ledger account ${l.account} missing in book ${args.book}`);
    return tx.ledgerJournal.create({
      data: {
        book: args.book,
        kind: args.kind,
        transactionId: args.transactionId ?? null,
        memo: args.memo,
        createdById: args.createdById ?? null,
        reversalOfId: args.reversalOfId ?? null,
        entries: { create: args.lines.map((l) => ({ accountId: byCode.get(l.account)!, debit: l.debit, credit: l.credit })) },
      },
    });
  }
}

@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
