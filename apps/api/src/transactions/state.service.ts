import { Injectable } from '@nestjs/common';
import { assertTransition, IllegalTransitionError, type TransactionState } from '@amico/contracts';
import type { Tx } from '../prisma/prisma.service';
import type { ActorType, Prisma, Transaction } from '../generated/prisma/client';
import { Conflict, NotFound } from '../common/errors';

export interface Actor {
  type: ActorType;
  id?: string | null;
}

/**
 * The only code path that changes Transaction.state. Must be called inside a DB
 * transaction: it row-locks the transaction (SELECT … FOR UPDATE), checks the
 * whitelist, bumps the version and appends a history row.
 */
@Injectable()
export class TransactionStateService {
  async lock(tx: Tx, transactionId: string): Promise<Transaction> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Transaction" WHERE id = ${transactionId} FOR UPDATE`;
    if (rows.length === 0) throw NotFound('Transaction');
    return tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  }

  async transition(
    tx: Tx,
    args: {
      transactionId: string;
      to: TransactionState;
      actor: Actor;
      reason: string;
      /** Refuse unless the current state is one of these (guards against stale workers). */
      from?: TransactionState[];
      metadata?: Record<string, unknown>;
      locked?: Transaction;
    },
  ): Promise<Transaction> {
    const current = args.locked ?? (await this.lock(tx, args.transactionId));
    if (args.from && !args.from.includes(current.state)) {
      throw Conflict('STATE_CHANGED', `Transaction is ${current.state}; expected ${args.from.join(' or ')}`);
    }
    try {
      assertTransition(current.state, args.to);
    } catch (e) {
      if (e instanceof IllegalTransitionError) throw Conflict('ILLEGAL_TRANSITION', e.message);
      throw e;
    }
    const updated = await tx.transaction.update({
      where: { id: current.id, version: current.version },
      data: { state: args.to, version: { increment: 1 } },
    });
    await tx.transactionStateHistory.create({
      data: {
        transactionId: current.id,
        fromState: current.state,
        toState: args.to,
        actorType: args.actor.type,
        actorId: args.actor.id ?? null,
        reason: args.reason,
        metadata: (args.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return updated;
  }

  /** A timeline note that changes nothing (from = to = current state), e.g. "customer asked to cancel". */
  async addNote(tx: Tx, transactionId: string, actor: Actor, reason: string) {
    const t = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId }, select: { state: true } });
    await tx.transactionStateHistory.create({
      data: { transactionId, fromState: t.state, toState: t.state, actorType: actor.type, actorId: actor.id ?? null, reason, metadata: { note: true } },
    });
  }
}
