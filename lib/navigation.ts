export const SECTIONS = ['overview', 'recommendations', 'agent', 'backtest', 'scenarios', 'drafts', 'data'] as const;
export type Section = typeof SECTIONS[number];

/** Resolve both current section hashes and links from the earlier workspace. */
export function parseSection(hash: string): Section {
  const section = hash.startsWith('#') ? hash.slice(1) : hash;
  if (section === 'api') return 'recommendations';
  if (section === 'orders') return 'drafts';
  if (section === 'start') return 'data';
  return SECTIONS.find(value => value === section) ?? 'overview';
}
