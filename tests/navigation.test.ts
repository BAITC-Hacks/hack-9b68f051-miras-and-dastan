import { describe, expect, it } from 'vitest';
import { parseSection, SECTIONS } from '../lib/navigation';

describe('workspace section links', () => {
  it('preserves old links to analysis, orders and data selection', () => {
    expect(parseSection('#api')).toBe('recommendations');
    expect(parseSection('#orders')).toBe('drafts');
    expect(parseSection('#start')).toBe('data');
  });

  it('keeps all seven current sections addressable', () => {
    expect(SECTIONS).toEqual(['overview', 'recommendations', 'agent', 'backtest', 'scenarios', 'drafts', 'data']);
    for (const section of SECTIONS) {
      expect(parseSection(`#${section}`)).toBe(section);
      expect(parseSection(section)).toBe(section);
    }
  });

  it('falls back safely for an unknown hash', () => {
    expect(parseSection('#missing')).toBe('overview');
    expect(parseSection('#constructor')).toBe('overview');
    expect(parseSection('#__proto__')).toBe('overview');
  });

  it('opens the overview for an absent or empty fragment', () => {
    expect(parseSection('')).toBe('overview');
    expect(parseSection('#')).toBe('overview');
  });
});
