import type { MessageKey } from '@/i18n/core';
import { DICTIONARIES } from '@/i18n/core';

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Translates a dynamic key when the dictionary has it, else returns the fallback. */
export function tx(t: TFn, key: string, fallback: string): string {
  return key in DICTIONARIES.en ? t(key as MessageKey) : fallback;
}

export function componentLabel(t: TFn, component: string, fallback?: string) {
  return tx(t, `component.${component}`, fallback ?? component);
}

export function groupLabel(t: TFn, group: string) {
  return tx(t, `group.${group}`, group);
}

export function stateLabel(t: TFn, state: string) {
  return tx(t, `state.${state}`, state.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
}
