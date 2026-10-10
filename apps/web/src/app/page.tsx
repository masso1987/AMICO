import Link from 'next/link';
import { Brand } from '@/components/Brand';
import { RouteList, type ServiceSummary } from '@/components/RouteList';
import { apiUrl, getToken } from '@/lib/session';

async function services(): Promise<ServiceSummary[]> {
  try {
    const res = await fetch(apiUrl('/services'), { cache: 'no-store' });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export default async function Home() {
  const [list, token] = await Promise.all([services(), getToken()]);
  const signedIn = Boolean(token);

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <Brand />
          <nav className="nav" aria-label="Account">
            {signedIn ? (
              <Link href="/app">My account</Link>
            ) : (
              <>
                <Link href="/login">Sign in</Link>
                <Link href="/register">Create account</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <div className="wrap">
          <section className="hero">
            <div>
              <h1>Move money between MTN and Orange.</h1>
              <p>
                Send from MoMo to Orange Money and back, turn spare airtime into cash, or top up any number.
                You see every fee before you confirm.
              </p>
              <div className="hero-actions">
                <Link className="btn btn-primary" href={signedIn ? '/app' : '/register'}>
                  {signedIn ? 'Start an exchange' : 'Create a free account'}
                </Link>
                {!signedIn && (
                  <Link className="btn btn-quiet" href="/login">
                    Sign in
                  </Link>
                )}
              </div>
            </div>
            <img className="hero-sphere" src="/sphere-512.png" alt="" width={420} height={420} />
          </section>

          <section aria-labelledby="available" className="stack">
            <h2 id="available" className="display" style={{ fontSize: 22 }}>
              Available now
            </h2>
            {list.length ? (
              <RouteList services={list} linkBase={signedIn ? '/app/send' : '/register'} />
            ) : (
              <p className="muted">No exchanges are open right now. Check back soon.</p>
            )}
          </section>

          <ol className="how" aria-label="How it works" style={{ marginTop: 48 }}>
            <li>
              <h3>Get a quote</h3>
              <p>Choose what you send and what arrives. The quote shows our fee, the operator fee and the exact amount received.</p>
            </li>
            <li>
              <h3>Pay from your phone</h3>
              <p>Approve the MoMo or Orange Money prompt, or transfer airtime to the AMICO number shown.</p>
            </li>
            <li>
              <h3>Track it to delivery</h3>
              <p>Follow each step live. You get a receipt once the recipient has been paid.</p>
            </li>
          </ol>
        </div>
      </main>
    </>
  );
}
