'use client';
import { Copy, Download, FileCheck2, RefreshCw } from 'lucide-react';
import { draftCsv, draftEmail, integer, money, type Draft } from '../lib/presentation';
import { Button, EmptyState, Notice, PageHeader } from './ui';
import styles from './Workspace.module.css';
export function DraftPanel({ draft, revision, onReview, onRecommendations, onMessage }: { draft: Draft | null; revision: string; onReview: () => void; onRecommendations: () => void; onMessage: (text: string, tone: 'success' | 'error') => void }) {
  const stale = draft && draft.revision !== revision;
  const groups = new Map<string, NonNullable<Draft>['items']>();
  for (const item of draft?.items ?? []) { const key = item.selectedSupplier?.supplierId || ''; groups.set(key, [...(groups.get(key) ?? []), item]); }
  const total = draft?.items.reduce((sum, item) => sum + item.estimatedCost, 0) ?? 0;
  function download() {
    if (!draft || stale || !draft.items.length) return;
    try {
      const url = URL.createObjectURL(new Blob([draftCsv(draft)], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a'); link.href = url; link.download = 'stockpilot-purchase-draft.csv'; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      onMessage('CSV подготовлен и передан браузеру для скачивания.', 'success');
    } catch { onMessage('Не удалось подготовить CSV. Повторите экспорт или скопируйте текст письма.', 'error'); }
  }
  async function copy() {
    if (!draft || stale) return;
    try { await navigator.clipboard.writeText(draftEmail(draft)); onMessage('Текст письма скопирован. Письмо не отправлено.', 'success'); }
    catch { onMessage('Браузер не разрешил копирование. Разрешите доступ к буферу или используйте CSV.', 'error'); }
  }
  return <><PageHeader title="Черновики заказов" description="Проверьте выбранные позиции перед передачей поставщикам." action={draft?.items.length ? <Button variant="primary" disabled={!!stale} onClick={download}><Download size={16} /> Скачать CSV</Button> : undefined} />
    {!draft?.items.length ? <EmptyState title="Черновик пока пуст" description="Выберите допустимые позиции в рекомендациях. Мы сгруппируем их по поставщикам и рассчитаем итог."><Button variant="primary" onClick={onRecommendations}>Выбрать товары</Button></EmptyState> : <>
      {stale && <Notice tone="warning"><strong>Расчёт изменился. Черновик требует пересмотра.</strong><br />Здесь сохранён прежний состав и прежние количества. Экспорт приостановлен.<div className={styles.inlineAction}><Button onClick={onReview}><RefreshCw size={15} /> Пересобрать по текущему расчёту</Button></div></Notice>}
      <div className={styles.draftSummary}><FileCheck2 size={24} /><div><h2>{draft.items.length} позиций · {groups.size} поставщика</h2><p>Создан {new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' }).format(new Date(draft.createdAt))} · хранится в этой вкладке</p></div><strong>{money(total)}</strong></div>
      {[...groups.entries()].map(([id, items]) => <section className={styles.panel} key={id}><div className={styles.sectionHeading}><div><h2>{items[0].selectedSupplier?.supplierName}</h2><p>{items.length} позиций · условия поставки из выбранного набора данных</p></div><strong>{money(items.reduce((sum, item) => sum + item.estimatedCost, 0))}</strong></div><div className={styles.tableScroll}><table className={`${styles.table} ${styles.comparison}`}><thead><tr><th>Товар / SKU</th><th className={styles.numeric}>Количество</th><th className={styles.numeric}>Цена</th><th className={styles.numeric}>Сумма</th><th className={styles.numeric}>Срок поставки</th></tr></thead><tbody>{items.map(item => <tr key={item.sku}><td>{item.productName}<small>{item.sku}</small></td><td className={styles.numeric}>{integer(item.recommendedQuantity)} шт.</td><td className={styles.numeric}>{money(item.selectedSupplier?.unitCost ?? 0)}</td><td className={styles.numeric}>{money(item.estimatedCost)}</td><td className={styles.numeric}>{item.leadTimeDays} дн.</td></tr>)}</tbody></table></div></section>)}
      <div className={styles.draftFooter}><p>Это черновик. Заказ не отправлен поставщику. После перезагрузки вкладки он не сохраняется.</p><Button disabled={!!stale} onClick={copy}><Copy size={16} /> Копировать текст письма</Button></div>
    </>}
  </>;
}
