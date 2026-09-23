'use client';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, ShoppingCart } from 'lucide-react';
import type { Dataset, Recommendation, Risk } from '../lib/types';
import { decimal, filterRecommendations, integer, money, orderBlockReason, sortRecommendations, weeklyHistoryIssue, type ProblemFilter, type SortKey } from '../lib/presentation';
import { Button, EmptyState, Notice, StatusBadge } from './ui';
import styles from './Workspace.module.css';

export type TableQuery = { search: string; filter: ProblemFilter; risk: 'all' | Risk; sort: SortKey; direction: 'asc' | 'desc'; page: number; size: number };
export const INITIAL_QUERY: TableQuery = { search: '', filter: 'all', risk: 'all', sort: 'priority', direction: 'asc', page: 1, size: 10 };
export function RecommendationsTable({ items, dataset, salesOnly, query, onQuery, selected, onSelect, onOpen, onDraft, compact = false, onAll }: {
  items: Recommendation[]; dataset: Dataset; salesOnly: boolean; query: TableQuery; onQuery: (query: TableQuery) => void;
  selected: string[]; onSelect: (skus: string[]) => void; onOpen: (sku: string) => void; onDraft: () => void; compact?: boolean; onAll?: () => void;
}) {
  const filtered = compact ? items : filterRecommendations(items, query.search, query.filter).filter(item => query.risk === 'all' || item.stockoutRisk === query.risk);
  const sorted = sortRecommendations(filtered, compact ? 'priority' : query.sort, query.direction);
  const pages = Math.max(1, Math.ceil(sorted.length / query.size));
  const page = Math.min(query.page, pages);
  const rows = compact ? sorted.slice(0, 5) : sorted.slice((page - 1) * query.size, page * query.size);
  const eligiblePage = rows.filter(item => !orderBlockReason(item, salesOnly));
  const selectedItems = items.filter(item => selected.includes(item.sku));
  const eligibleSelected = selectedItems.filter(item => !orderBlockReason(item, salesOnly));
  const allPage = eligiblePage.length > 0 && eligiblePage.every(item => selected.includes(item.sku));
  function change(value: Partial<TableQuery>) { onQuery({ ...query, ...value, page: 1 }); }
  function toggle(sku: string) { onSelect(selected.includes(sku) ? selected.filter(value => value !== sku) : [...selected, sku]); }
  function togglePage() { const skus = new Set(eligiblePage.map(item => item.sku)); onSelect(allPage ? selected.filter(sku => !skus.has(sku)) : [...new Set([...selected, ...skus])]); }
  function heading(label: string, sort?: SortKey) {
    return sort && !compact ? <button className={styles.sortButton} onClick={() => change({ sort, direction: query.sort === sort && query.direction === 'asc' ? 'desc' : 'asc' })}>{label}{query.sort !== sort ? <ArrowUpDown size={13} /> : query.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</button> : label;
  }
  function sortAria(sort: SortKey): 'ascending' | 'descending' | 'none' { return query.sort === sort ? query.direction === 'asc' ? 'ascending' : 'descending' : 'none'; }
  return <section className={styles.tableSection} aria-label={compact ? 'Приоритетные рекомендации' : 'Все рекомендации'}>
    {compact ? <div className={styles.sectionHeading}><div><h2>Приоритетные рекомендации</h2><p>Первые {rows.length} из {items.length} позиций, по риску дефицита</p></div><Button variant="ghost" onClick={onAll}>Все рекомендации <ChevronRight size={16} /></Button></div> : <div className={styles.tableTools}>
      <label className={styles.search}><Search size={17} aria-hidden="true" /><span className="sr-only">Поиск по SKU или товару</span><input placeholder="Найти товар или SKU…" value={query.search} onChange={event => change({ search: event.target.value })} /></label>
      <label><span className="sr-only">Проблема или действие</span><select aria-label="Проблема или действие" value={query.filter} onChange={event => change({ filter: event.target.value as ProblemFilter })}><option value="all">Все позиции</option><option value="urgent">Срочные</option><option value="order">Есть рекомендация</option><option value="anomalies">Аномальные наблюдения</option><option value="supplier">Нет поставщика</option><option value="budget">Вне бюджета</option><option value="quality">Проблемы данных и условий</option></select></label>
      <label><span className="sr-only">Риск запаса</span><select aria-label="Риск запаса" value={query.risk} onChange={event => change({ risk: event.target.value as TableQuery['risk'] })}><option value="all">Любой риск</option><option value="critical">Критический дефицит</option><option value="high">Высокий риск</option><option value="healthy">Нормальный запас</option><option value="watch">Выше целевого запаса</option><option value="overstock">Избыточный запас</option><option value="review">Требуется проверка</option></select></label>
      {(query.search || query.filter !== 'all' || query.risk !== 'all' || query.sort !== 'priority') && <Button variant="ghost" onClick={() => onQuery({ ...INITIAL_QUERY, size: query.size })}>Сбросить</Button>}
    </div>}
    {!compact && selected.length > 0 && <div className={styles.selectionBar}><span><b>Выбрано: {selectedItems.length}</b> · к оформлению {eligibleSelected.length} · {money(eligibleSelected.reduce((sum, item) => sum + item.estimatedCost, 0))}</span><div><Button variant="ghost" onClick={() => onSelect([])}>Снять выбор</Button><Button variant="primary" disabled={!eligibleSelected.length} onClick={onDraft}><ShoppingCart size={16} /> Создать черновик</Button></div></div>}
    {!compact && selectedItems.length > eligibleSelected.length && <Notice tone="warning">{selectedItems.length - eligibleSelected.length} выбранных позиций сейчас нельзя оформить. Проверьте условия в карточках; в черновик войдут только допустимые позиции.</Notice>}
    {rows.length ? <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Таблица товаров, прокрутка по горизонтали"><table className={styles.table}><caption className="sr-only">Рекомендации пополнения. Количества в штуках, стоимость в тенге.</caption><thead><tr>
      {!compact && <th className={styles.checkCell}><input type="checkbox" aria-label="Выбрать страницу" title="Выбрать допустимые позиции только на этой странице" checked={allPage} disabled={!eligiblePage.length} onChange={togglePage} /></th>}
      <th aria-sort={sortAria('productName')}>{heading('Товар / SKU', 'productName')}</th><th>Статус</th>
      {!compact && <th className={styles.numeric} aria-sort={sortAria('stockPosition')}>{heading('Позиция, шт.', 'stockPosition')}</th>}
      <th className={styles.numeric} aria-sort={sortAria('daysOfCover')}>{heading('Покрытие', 'daysOfCover')}</th>
      {!compact && <th className={styles.numeric} aria-sort={sortAria('forecastDemand')}>{heading('Прогноз / нед.', 'forecastDemand')}</th>}
      <th className={styles.numeric} aria-sort={sortAria('recommendedQuantity')}>{heading('Заказать, шт.', 'recommendedQuantity')}</th>
      {!compact && <th>Поставщик</th>}<th className={styles.numeric} aria-sort={sortAria('estimatedCost')}>{heading('Сумма', 'estimatedCost')}</th>
    </tr></thead><tbody>{rows.map(item => {
      const blocked = orderBlockReason(item, salesOnly);
      const weeklyIssue = salesOnly ? weeklyHistoryIssue(dataset, item.sku) : null;
      return <tr key={item.sku} data-selected={selected.includes(item.sku)}>
        {!compact && <td className={styles.checkCell}><span title={blocked || 'Добавить в выбор'}><input type="checkbox" aria-label={`Выбрать ${item.sku}`} aria-describedby={blocked ? `blocked-${item.sku}` : undefined} checked={selected.includes(item.sku)} disabled={!!blocked && !selected.includes(item.sku)} onChange={() => toggle(item.sku)} /></span>{blocked && <span id={`blocked-${item.sku}`} className="sr-only">{blocked}</span>}</td>}
        <td className={styles.productCell}><button className={styles.productButton} onClick={() => onOpen(item.sku)} aria-label={`Открыть ${item.sku}`} title={item.productName}><strong>{item.productName}</strong><span>{item.sku}</span></button></td>
        <td><StatusBadge item={item} /></td>
        {!compact && <td className={styles.numeric}>{salesOnly ? <span title="Остаток не загружен">Неизвестно</span> : integer(item.stockPosition)}</td>}
        <td className={styles.numeric}>{salesOnly || item.daysOfCover === 999 ? '—' : `${item.daysOfCover} дн.`}</td>
        {!compact && <td className={styles.numeric} title={weeklyIssue || undefined}>{weeklyIssue ? '—' : `${decimal(item.forecastDemand)} шт.`}</td>}
        <td className={`${styles.numeric} ${styles.quantity}`}>{salesOnly ? '—' : integer(item.recommendedQuantity)}</td>
        {!compact && <td className={styles.supplierCell} title={item.selectedSupplier?.supplierName}>{item.selectedSupplier?.supplierName || 'Не указан'}</td>}
        <td className={styles.numeric}>{salesOnly ? '—' : money(item.estimatedCost)}</td>
      </tr>;
    })}</tbody></table></div> : <EmptyState title="Совпадений нет" description="Измените поисковый запрос или сбросьте фильтры, чтобы увидеть все товары."><Button onClick={() => onQuery(INITIAL_QUERY)}>Сбросить фильтры</Button></EmptyState>}
    {!compact && <footer className={styles.pagination}><span>{sorted.length ? `${(page - 1) * query.size + 1}–${Math.min(page * query.size, sorted.length)}` : '0'} из {sorted.length} товаров</span><div><label>На странице <select aria-label="Товаров на странице" value={query.size} onChange={event => change({ size: Number(event.target.value) })}>{[10,20,50].map(size => <option key={size} value={size}>{size}</option>)}</select></label><Button aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => onQuery({ ...query, page: page - 1 })}><ChevronLeft size={16} /></Button><span>{page} / {pages}</span><Button aria-label="Следующая страница" disabled={page >= pages} onClick={() => onQuery({ ...query, page: page + 1 })}><ChevronRight size={16} /></Button></div></footer>}
  </section>;
}
