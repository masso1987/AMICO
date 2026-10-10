import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/session';
import { dateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Messages' };

interface Note {
  id: string;
  transactionId: string | null;
  title: string;
  body: string;
  createdAt: string;
}

export default async function Notifications() {
  let notes: Note[];
  try {
    notes = await apiFetch<Note[]>('/notifications');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login?next=/app/notifications');
    throw e;
  }
  return (
    <>
      <h1 className="page-title">Messages</h1>
      {notes.length === 0 ? (
        <p className="lede">Updates about your exchanges will appear here.</p>
      ) : (
        <ul className="routes" style={{ maxWidth: 720 }}>
          {notes.map((n) => (
            <li key={n.id} style={{ padding: '16px 4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong>{n.title}</strong>
                <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                  {dateTime(n.createdAt)}
                </span>
              </div>
              <p style={{ margin: '4px 0 0' }} className="muted">
                {n.body}
              </p>
              {n.transactionId && (
                <Link href={`/app/transactions/${n.transactionId}`} style={{ fontSize: 14 }}>
                  View exchange
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
