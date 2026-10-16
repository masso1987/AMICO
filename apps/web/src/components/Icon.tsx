const PATHS: Record<string, React.ReactNode> = {
  airtime: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
      <path d="M12 7.5v6M9.5 10.5h5" />
    </>
  ),
  bundle: (
    <>
      <path d="M4 9.5a12 12 0 0 1 16 0" />
      <path d="M7 13a7.5 7.5 0 0 1 10 0" />
      <path d="M10 16.4a3 3 0 0 1 4 0" />
      <circle cx="12" cy="19.5" r="0.6" fill="currentColor" />
    </>
  ),
  sell: (
    <>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M9 6.5v5M7.2 8h3.2" />
      <path d="M14 18.5h7M18 15.5l3 3-3 3" />
    </>
  ),
  swap: (
    <>
      <path d="M4 8h14M14.5 4.5 18 8l-3.5 3.5" />
      <path d="M20 16H6M9.5 12.5 6 16l3.5 3.5" />
    </>
  ),
  exchange: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M16 14.5h2" />
      <path d="M7 3.5h10" />
    </>
  ),
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7" />
      <path d="M4 4.5v4.2h4.2" />
      <path d="M12 8v4.5l3 2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 21h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  back: <path d="m15 5-7 7 7 7" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z" />
      <path d="m8.8 12.2 2.3 2.3 4.3-4.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  refund: (
    <>
      <path d="M4 12a8 8 0 1 0 8-8" />
      <path d="M4 4.5V9h4.5" />
      <path d="M12 8.5v7M10 10h3.2a1.3 1.3 0 0 1 0 2.6H10.8a1.3 1.3 0 0 0 0 2.6H14" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M10 12h10M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, label }: { name: string; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name] ?? null}
    </svg>
  );
}

/** Icon per product group. */
export const GROUP_ICON: Record<string, string> = {
  BUY_AIRTIME: 'airtime',
  BUNDLES: 'bundle',
  SELL_CREDIT: 'sell',
  AIRTIME_SWAP: 'swap',
  MONEY_EXCHANGE: 'exchange',
};
