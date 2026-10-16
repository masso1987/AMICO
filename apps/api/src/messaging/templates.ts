/**
 * Every customer-facing message, in English and French. The in-app notification uses
 * title + body; SMS and WhatsApp use the short `sms` text (kept under 160 characters
 * where possible so one SMS is enough).
 */

export type Locale = 'en' | 'fr';

export function fcfa(n: number, locale: Locale = 'en'): string {
  const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return locale === 'fr' ? `${s} FCFA` : `${s} FCFA`;
}

/** 237677123456 -> 677 12 34 56 */
export function prettyMsisdn(m: string): string {
  const n = m.replace(/^237/, '');
  return n.length === 9 ? `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}` : m;
}

export interface Rendered {
  title: string;
  body: string;
  sms: string;
}

type P = { ref: string; amount?: number; to?: string; delivered?: number; fee?: number; sim?: boolean };
const simEn = (p: P) => (p.sim ? ' (SIMULATION, no real money)' : '');
const simFr = (p: P) => (p.sim ? ' (SIMULATION, aucun argent réel)' : '');

const T: Record<string, Record<Locale, (p: P) => Rendered>> = {
  PAYMENT_CONFIRMED: {
    en: (p) => ({ title: 'Payment received', body: `We received ${fcfa(p.amount!)} for ${p.ref}.`, sms: `AMICO: payment of ${fcfa(p.amount!)} received for ${p.ref}. Delivery is on its way.${simEn(p)}` }),
    fr: (p) => ({ title: 'Paiement reçu', body: `Nous avons reçu ${fcfa(p.amount!, 'fr')} pour ${p.ref}.`, sms: `AMICO : paiement de ${fcfa(p.amount!, 'fr')} reçu pour ${p.ref}. Livraison en cours.${simFr(p)}` }),
  },
  SOURCE_CONFIRMED: {
    en: (p) => ({ title: 'Airtime received', body: `We confirmed the ${fcfa(p.amount!)} airtime you sent for ${p.ref}.`, sms: `AMICO: we received your ${fcfa(p.amount!)} airtime for ${p.ref}. Payment is on its way.${simEn(p)}` }),
    fr: (p) => ({ title: 'Crédit reçu', body: `Nous avons confirmé les ${fcfa(p.amount!, 'fr')} de crédit envoyés pour ${p.ref}.`, sms: `AMICO : crédit de ${fcfa(p.amount!, 'fr')} reçu pour ${p.ref}. Paiement en cours.${simFr(p)}` }),
  },
  COMPLETED: {
    en: (p) => ({
      title: p.sim ? 'SIMULATION — completed' : 'Completed',
      body: `${fcfa(p.delivered!)} delivered to ${prettyMsisdn(p.to!)}. Reference ${p.ref}.${p.sim ? ' This was a simulation: no real money moved.' : ''}`,
      sms: `AMICO: ${fcfa(p.delivered!)} delivered to ${prettyMsisdn(p.to!)}. Ref ${p.ref}.${simEn(p)}`,
    }),
    fr: (p) => ({
      title: p.sim ? 'SIMULATION — terminé' : 'Terminé',
      body: `${fcfa(p.delivered!, 'fr')} livrés au ${prettyMsisdn(p.to!)}. Référence ${p.ref}.${p.sim ? ' Ceci était une simulation : aucun argent réel.' : ''}`,
      sms: `AMICO : ${fcfa(p.delivered!, 'fr')} livrés au ${prettyMsisdn(p.to!)}. Réf ${p.ref}.${simFr(p)}`,
    }),
  },
  BUNDLE_COMPLETED: {
    en: (p) => ({ title: 'Bundle activated', body: `Your bundle is active on ${prettyMsisdn(p.to!)}. Reference ${p.ref}.`, sms: `AMICO: bundle activated on ${prettyMsisdn(p.to!)}. Ref ${p.ref}.${simEn(p)}` }),
    fr: (p) => ({ title: 'Forfait activé', body: `Votre forfait est actif sur le ${prettyMsisdn(p.to!)}. Référence ${p.ref}.`, sms: `AMICO : forfait activé sur le ${prettyMsisdn(p.to!)}. Réf ${p.ref}.${simFr(p)}` }),
  },
  REJECTED: {
    en: (p) => ({ title: 'Not completed', body: `${p.ref} did not go through. No money was taken.`, sms: `AMICO: ${p.ref} did not go through. No money was taken.` }),
    fr: (p) => ({ title: 'Non abouti', body: `${p.ref} n’a pas abouti. Aucun montant n’a été prélevé.`, sms: `AMICO : ${p.ref} n’a pas abouti. Aucun montant prélevé.` }),
  },
  NOT_RECEIVED: {
    en: (p) => ({ title: 'Airtime not received', body: `We could not find your airtime transfer for ${p.ref}. Nothing will be paid out. Contact us if you sent it.`, sms: `AMICO: we did not receive the airtime for ${p.ref}. Contact us if you sent it.` }),
    fr: (p) => ({ title: 'Crédit non reçu', body: `Nous n’avons pas trouvé votre transfert de crédit pour ${p.ref}. Rien ne sera payé. Contactez-nous si vous l’avez envoyé.`, sms: `AMICO : crédit non reçu pour ${p.ref}. Contactez-nous si vous l’avez envoyé.` }),
  },
  FAILED: {
    en: (p) => ({ title: 'Delivery failed', body: `Delivery for ${p.ref} failed. You will get a full refund.`, sms: `AMICO: delivery for ${p.ref} failed. You will get a full refund.` }),
    fr: (p) => ({ title: 'Échec de la livraison', body: `La livraison pour ${p.ref} a échoué. Vous serez remboursé intégralement.`, sms: `AMICO : échec de la livraison ${p.ref}. Remboursement intégral à venir.` }),
  },
  CANCELLED: {
    en: (p) => ({ title: 'Cancelled', body: `${p.ref} was cancelled. Nothing was charged.`, sms: `AMICO: ${p.ref} cancelled. Nothing was charged.` }),
    fr: (p) => ({ title: 'Annulé', body: `${p.ref} a été annulé. Rien n’a été prélevé.`, sms: `AMICO : ${p.ref} annulé. Rien n’a été prélevé.` }),
  },
  CANCEL_REFUND: {
    en: (p) => ({ title: 'Cancellation accepted', body: `${p.ref} is cancelled. ${fcfa(p.amount!)} will be refunded (cancellation fee ${fcfa(p.fee!)}).`, sms: `AMICO: ${p.ref} cancelled. Refund of ${fcfa(p.amount!)} on its way (fee ${fcfa(p.fee!)}).` }),
    fr: (p) => ({ title: 'Annulation acceptée', body: `${p.ref} est annulé. ${fcfa(p.amount!, 'fr')} vous seront remboursés (frais d’annulation ${fcfa(p.fee!, 'fr')}).`, sms: `AMICO : ${p.ref} annulé. Remboursement de ${fcfa(p.amount!, 'fr')} en cours (frais ${fcfa(p.fee!, 'fr')}).` }),
  },
  REFUNDED: {
    en: (p) => ({ title: 'Refund completed', body: `${fcfa(p.amount!)} was refunded for ${p.ref}.`, sms: `AMICO: ${fcfa(p.amount!)} refunded for ${p.ref}.${simEn(p)}` }),
    fr: (p) => ({ title: 'Remboursement effectué', body: `${fcfa(p.amount!, 'fr')} ont été remboursés pour ${p.ref}.`, sms: `AMICO : ${fcfa(p.amount!, 'fr')} remboursés pour ${p.ref}.${simFr(p)}` }),
  },
};

export function render(kind: keyof typeof T | string, locale: Locale, p: P): Rendered {
  const t = T[kind];
  if (!t) throw new Error(`No message template ${kind}`);
  return t[locale === 'fr' ? 'fr' : 'en'](p);
}

export const TEMPLATE_KINDS = Object.keys(T);
