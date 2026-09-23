'use client';
import { useSyncExternalStore } from 'react';
export type Section = 'overview' | 'recommendations' | 'backtest' | 'scenarios' | 'drafts' | 'data';
const sections: Section[] = ['overview','recommendations','backtest','scenarios','drafts','data'];
function subscribe(callback: () => void) {
  const onChange = () => { callback(); window.scrollTo({ top: 0, behavior: 'instant' }); };
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
function snapshot(): Section { const hash = window.location.hash.slice(1) as Section; return sections.includes(hash) ? hash : 'overview'; }
export const navigate = (section: Section) => { window.location.hash = section; };
export function useSection() { return useSyncExternalStore(subscribe, snapshot, () => 'overview' as Section); }
