'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChartNoAxesCombined, Database, History, PlugZap } from 'lucide-react';
import styles from './PreviewNavigation.module.css';

export type PreviewView = 'start' | 'overview' | 'backtest' | 'api';

export function usePreviewNavigation() {
  const [view, setView] = useState<PreviewView>('start');

  useEffect(() => {
    // Reloads start at data selection: datasets remain in memory only.
    window.history.replaceState(window.history.state, '', '#start');
    const onBack = () => {
      const hash = window.location.hash.slice(1);
      setView(hash === 'overview' || hash === 'backtest' || hash === 'api' ? hash : 'start');
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  const navigate = useCallback((next: PreviewView) => {
    if (window.location.hash !== `#${next}`) {
      // Leave Next's history metadata management to Next itself.
      window.history.pushState(null, '', `#${next}`);
    }
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);

  return { view, navigate };
}

export default function PreviewNavigation({ view, source, onNavigate }: {
  view: PreviewView;
  source: string;
  onNavigate: (view: PreviewView) => void;
}) {
  const tabs = [
    { id: 'overview' as const, label: 'Обзор закупок', icon: ChartNoAxesCombined },
    { id: 'backtest' as const, label: 'Проверка на прошлом', icon: History },
    { id: 'api' as const, label: 'API-анализ', icon: PlugZap },
  ];
  return <div className={styles.workspaceNav}>
    <div className={styles.sourceRow}>
      <button className={styles.sourceButton} type="button" onClick={() => onNavigate('start')}>
        <ArrowLeft size={16} aria-hidden="true" /> Выбор данных
      </button>
      <span className={styles.source}><Database size={14} aria-hidden="true" />{source}</span>
    </div>
    <nav className={styles.tabs} aria-label="Разделы рабочего пространства">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button"
        className={`${styles.tab} ${view === id ? styles.active : ''}`}
        aria-current={view === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
        <Icon size={16} aria-hidden="true" />{label}
      </button>)}
    </nav>
  </div>;
}
