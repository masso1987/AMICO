import Link from 'next/link';

export function Brand({ href = '/', label }: { href?: string; label: string }) {
  return (
    <Link href={href} className="brand" aria-label={label}>
      <img src="/favicon-64.png" alt="" width={34} height={34} />
      <span>AMICO</span>
    </Link>
  );
}
