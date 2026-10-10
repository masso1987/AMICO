/** 237699123456 -> 2376•••••456. Used in every general staff view and in logs. */
export function maskMsisdn(msisdn: string): string {
  if (msisdn.length <= 7) return '•'.repeat(msisdn.length);
  return `${msisdn.slice(0, 4)}${'•'.repeat(msisdn.length - 7)}${msisdn.slice(-3)}`;
}
