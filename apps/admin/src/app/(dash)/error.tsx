'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card">
      <h2>This page didn’t load</h2>
      <p style={{ color: 'var(--muted)' }}>The AMICO API may be briefly unreachable. Nothing was changed.</p>
      <button className="btn btn-quiet" onClick={reset}>Try again</button>
    </div>
  );
}
