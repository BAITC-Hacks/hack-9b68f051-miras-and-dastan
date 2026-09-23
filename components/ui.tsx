'use client';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { Recommendation } from '../lib/types';
import { isBudgetExcluded, statusLabel } from '../lib/presentation';
import styles from './ui.module.css';

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button type={type} className={`${styles.button} ${styles[variant]} ${className}`} {...props} />;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function StatusBadge({ item }: { item: Recommendation }) {
  const tone = isBudgetExcluded(item) ? 'warning' : item.recommendationStatus === 'Заказать срочно' ? 'error' : item.recommendationStatus === 'Запланировать заказ' ? 'warning' : item.recommendationStatus === 'Заказ не требуется' ? 'success' : 'neutral';
  return <span className={`${styles.badge} ${styles[tone]}`}>{tone === 'error' && <AlertCircle size={13} aria-hidden="true" />}{statusLabel(item)}</span>;
}
export function Notice({ tone = 'info', children, onDismiss }: { tone?: 'info' | 'success' | 'warning' | 'error'; children: ReactNode; onDismiss?: () => void }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' || tone === 'warning' ? AlertCircle : Info;
  return <div className={`${styles.notice} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}><Icon size={17} aria-hidden="true" /><div>{children}</div>{onDismiss && <button type="button" className={styles.dismiss} aria-label="Закрыть сообщение" onClick={onDismiss}><X size={16} /></button>}</div>;
}
export function EmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <section className={styles.empty}><h2>{title}</h2><p>{description}</p>{children && <div className={styles.actions}>{children}</div>}</section>;
}
export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className={styles.pageHeader}><div>{eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className={styles.actions}>{action}</div>}</header>;
}
export function Kpi({ label, value, description }: { label: string; value: ReactNode; description: string }) {
  return <article className={styles.kpi}><p>{label}</p><strong>{value}</strong><span>{description}</span></article>;
}
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.drawer} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}><header className={styles.drawerHeader}><span id={titleId}>{title}</span><Button variant="ghost" onClick={onClose} aria-label="Закрыть карточку"><X size={20} /></Button></header><div className={styles.drawerBody}>{children}</div></dialog>;
}
