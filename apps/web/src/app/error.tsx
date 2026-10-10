'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <div className="wrap">
        <h1 className="page-title">This page didn’t load</h1>
        <p className="lede">AMICO may be briefly unreachable. Your exchanges are safe: nothing changes until you confirm.</p>
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
