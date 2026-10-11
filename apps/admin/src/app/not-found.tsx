import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ padding: 40 }}>
      <h1>Not found</h1>
      <p>This record doesn’t exist or you don’t have access to it.</p>
      <Link href="/">Back to the overview</Link>
    </main>
  );
}
