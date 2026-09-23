'use client';
import { useSyncExternalStore } from 'react';
import { parseSection, type Section } from '../lib/navigation';
export type { Section } from '../lib/navigation';
function subscribe(callback: () => void) {
  const onChange = () => { callback(); window.scrollTo({ top: 0, behavior: 'instant' }); };
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
function snapshot(): Section { return parseSection(window.location.hash); }
export const navigate = (section: Section) => { window.location.hash = section; };
export function useSection() { return useSyncExternalStore(subscribe, snapshot, () => 'overview' as Section); }
