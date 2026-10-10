import Link from 'next/link';

export default function NotFound() {
  return (
    <main>
      <div className="wrap">
        <h1 className="page-title">Page not found</h1>
        <p className="lede">The link may be old, or the exchange belongs to another account.</p>
        <Link className="btn btn-primary" href="/app">
          Go to my account
        </Link>
      </div>
    </main>
  );
}
