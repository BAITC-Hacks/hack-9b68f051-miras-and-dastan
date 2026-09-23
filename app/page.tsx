'use client';

import { useMemo, useState } from 'react';
import { Activity, ArrowRight, BarChart3, Bot, Boxes, Check, ChevronRight, Database, FileSpreadsheet, History, LayoutDashboard, Menu, Package, Play, ShoppingCart, SlidersHorizontal, Upload, X } from 'lucide-react';
import { analyzeDataset } from '../lib/analytics';
import { makeDemoData } from '../lib/demo-data';
import type { Dataset, Scenario } from '../lib/types';
import { BASE_SCENARIO, createDraft, dateLabel, integer, money, orderBlockReason, summarize, type Draft, type ProblemFilter } from '../lib/presentation';
import { getWeeklyStructureIssues } from '../lib/import-data';
import { navigate, useSection, type Section } from '../hooks/useSection';
import { Button, EmptyState, Kpi, Notice, PageHeader } from '../components/ui';
import { INITIAL_QUERY, RecommendationsTable, type TableQuery } from '../components/RecommendationsTable';
import { ImportPanel } from '../components/ImportPanel';
import { SkuDrawer } from '../components/SkuDrawer';
import { ScenarioPanel } from '../components/ScenarioPanel';
import { DraftPanel } from '../components/DraftPanel';
import { HistoryPanel } from '../components/HistoryPanel';
import AgentWorkspace from '../components/openai/AgentWorkspace';
import styles from '../components/Workspace.module.css';

const sections = [
  { id: 'overview', name: 'Обзор', icon: LayoutDashboard },
  { id: 'recommendations', name: 'Рекомендации', icon: Package },
  { id: 'agent', name: 'ИИ-агент', icon: Bot },
  { id: 'backtest', name: 'Проверка на истории', icon: History },
  { id: 'scenarios', name: 'Сценарии', icon: SlidersHorizontal },
  { id: 'drafts', name: 'Черновики заказов', icon: ShoppingCart },
  { id: 'data', name: 'Данные', icon: Database },
] as const;
type Source = { kind: 'demo' | 'import'; name: string };
type Message = { text: string; tone: 'success' | 'error' | 'info' | 'warning' };

export default function Home() {
  const section = useSection();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const [scenario, setScenario] = useState<Scenario>(BASE_SCENARIO);
  const [query, setQuery] = useState<TableQuery>(INITIAL_QUERY);
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [historySku, setHistorySku] = useState('CAB-NYM-3X2.5');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const salesOnly = source?.kind === 'import';
  const recommendations = useMemo(() => dataset ? analyzeDataset(dataset, scenario) : [], [dataset, scenario]);
  const base = useMemo(() => dataset ? analyzeDataset(dataset, BASE_SCENARIO) : [], [dataset]);
  const summary = useMemo(() => summarize(recommendations, salesOnly), [recommendations, salesOnly]);
  const weeklyIssues = useMemo(() => dataset ? getWeeklyStructureIssues(dataset.sales) : [], [dataset]);
  const selectedItem = recommendations.find(item => item.sku === selectedSku);
  const revision = `${dataRevision}:${JSON.stringify(scenario)}`;
  const dates = useMemo(() => dataset?.sales.map(row => row.date).sort() ?? [], [dataset]);
  const period = dates.length ? `${dateLabel(dates[0])} — ${dateLabel(dates[dates.length - 1])}` : 'История ещё не загружена';
  const sourceLabel = source?.kind === 'demo' ? 'Демо-данные' : source ? 'Импортированный файл' : 'Нет данных';

  function go(next: Section) { navigate(next); setMenuOpen(false); }
  function openImport() { setImporting(true); setMessage(null); go('data'); }
  function loadData(data: Dataset, nextSource: Source) {
    setDataset(data); setSource(nextSource); setDataRevision(value => value + 1); setScenario(BASE_SCENARIO); setSelectedSkus([]); setSelectedSku(null); setQuery(INITIAL_QUERY); setImporting(false);
    setHistorySku(data.products.some(product => product.sku === 'CAB-NYM-3X2.5') ? 'CAB-NYM-3X2.5' : data.products[0]?.sku ?? '');
    setMessage({ text: nextSource.kind === 'demo' ? `Демо загружено: ${data.products.length} товаров. Все показатели рассчитаны по этому набору.` : `Файл «${nextSource.name}» импортирован. Закупки недоступны: загружены только продажи.`, tone: nextSource.kind === 'demo' ? 'success' : 'warning' });
    go(nextSource.kind === 'demo' ? 'overview' : 'data');
  }
  function filterTo(filter: ProblemFilter) { setQuery({ ...INITIAL_QUERY, filter }); go('recommendations'); }
  function selectSku(sku: string) { setSelectedSkus(values => values.includes(sku) ? values.filter(value => value !== sku) : [...values, sku]); }
  function makeDraft() {
    const next = createDraft(recommendations, selectedSkus, revision, salesOnly);
    if (!next) { setMessage({ text: 'Выберите допустимые позиции. Причины ограничений доступны в карточках товаров.', tone: 'warning' }); return; }
    setDraft(next); setMessage({ text: `Черновик из ${next.items.length} выбранных позиций создан в этой вкладке. Заказ не отправлен.`, tone: 'success' }); go('drafts');
  }
  function reviewDraft() {
    if (!draft) return;
    const next = createDraft(recommendations, draft.items.map(item => item.sku), revision, salesOnly);
    if (!next) { setMessage({ text: 'В прежнем составе нет допустимых позиций для нового расчёта. Перейдите к рекомендациям и выберите товары заново.', tone: 'warning' }); return; }
    const removed = draft.items.length - next.items.length;
    setDraft(next); setMessage({ text: `Черновик пересобран по текущему расчёту.${removed ? ` Исключено недоступных позиций: ${removed}.` : ''} Проверьте обновлённые количества.`, tone: removed ? 'warning' : 'success' });
  }
  const tableProps = { items: recommendations, dataset: dataset!, salesOnly, query, onQuery: setQuery, selected: selectedSkus, onSelect: setSelectedSkus, onOpen: setSelectedSku, onDraft: makeDraft };
  return <div className={styles.shell}>
    <a className={styles.skipLink} href="#workspace-main" onClick={event => { event.preventDefault(); const main = document.getElementById('workspace-main'); main?.focus(); main?.scrollIntoView({ block: 'start' }); }}>Перейти к содержимому</a>
    <aside className={styles.sidebar}><a className={styles.brand} href="#overview" aria-label="StockPilot, обзор"><span><Boxes size={21} /></span><b>StockPilot<span className={styles.brandAi}>AI</span></b></a>
      <div className={styles.workspaceLabel}>УПРАВЛЕНИЕ ЗАКУПКАМИ</div>
      <nav aria-label="Основные разделы">{sections.map(({ id, name, icon: Icon }) => <a key={id} href={`#${id}`} aria-current={section === id ? 'page' : undefined}><Icon size={18} /><span>{name}</span>{id === 'drafts' && draft && <b className={styles.navCount}>1</b>}</a>)}</nav>
      <div className={styles.sidebarFooter}><div><span className={styles.workspaceAvatar}>Э</span><span><b>Электрокомплект</b><small>Рабочее пространство</small></span></div><p><Check size={14} /> Объяснимые рекомендации</p></div>
    </aside>
    <div className={styles.mainColumn}>
      <header className={styles.contextBar}><div className={styles.contextName}><Button variant="ghost" className={styles.mobileToggle} aria-expanded={menuOpen} aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</Button><span>Закупки</span><ChevronRight size={14} /><strong>{sections.find(item => item.id === section)?.name}</strong></div><div className={styles.sourceContext}><span className={styles.sourceBadge}><Database size={13} />{sourceLabel}</span><span className={styles.period}>{period}</span></div></header>
      {menuOpen && <nav className={styles.mobileMenu} aria-label="Мобильная навигация">{sections.map(({id,name,icon:Icon}) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)} aria-current={section === id ? 'page' : undefined}><Icon size={17} />{name}</a>)}</nav>}
      <main id="workspace-main" className={styles.workspace} tabIndex={-1}>
        {message && <div className={styles.message}><Notice tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Notice></div>}
        {section === 'data' ? <>
          <PageHeader title="Данные" description="Источник расчётов и качество исходной истории." action={!importing ? <Button variant="primary" onClick={openImport}><Upload size={16} /> Импортировать данные</Button> : undefined} />
          {importing ? <ImportPanel onImport={(data, fileName) => loadData(data, { kind: 'import', name: fileName })} onCancel={() => setImporting(false)} /> : dataset ? <>
            <section className={styles.panel}><div className={styles.sectionHeading}><div><h2><FileSpreadsheet size={19} /> {source?.name}</h2><p>{sourceLabel} · {period}</p></div><Button onClick={() => loadData(makeDemoData(), { kind: 'demo', name: 'Демонстрационный набор StockPilot' })}>Открыть демо</Button></div><div className={styles.dataMetrics}><div><strong>{integer(dataset.products.length)}</strong><span>товаров</span></div><div><strong>{integer(dataset.sales.length)}</strong><span>строк продаж</span></div><div><strong>{dataset.inventory.length ? integer(dataset.inventory.length) : 'Не загружены'}</strong><span>остатки по SKU</span></div><div><strong>{dataset.suppliers.length ? integer(dataset.suppliers.length) : 'Не загружены'}</strong><span>условия поставщиков</span></div></div></section>
            {salesOnly && <Notice tone="warning">Поддержан импорт продаж. Остатки, поставки в пути и условия поставщиков не загружены; их значения неизвестны. Создание закупочных черновиков заблокировано. Для полного демонстрационного сценария откройте демо.</Notice>}
            <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Недельная структура истории</h2><p>Требуется для прогноза в штуках за неделю и проверки на истории</p></div></div>{weeklyIssues.length ? <><Notice tone="warning">{weeklyIssues.length} товаров требуют подготовки недельного ряда. Пропуски не заполнены нулями.</Notice><ul className={styles.issueList}>{weeklyIssues.map(issue => <li key={issue.sku}><strong>{issue.sku}</strong> — {issue.reason}</li>)}</ul></> : <Notice tone="success">У каждого товара последовательная недельная история без дублей и пропусков.</Notice>}<p className={styles.helper}>Данные и черновики находятся в памяти текущей вкладки. Перезагрузка очищает их; импортированный файл не сохраняется в браузере автоматически.</p></section>
          </> : <EmptyState title="Добавьте историю продаж" description="Импортируйте Excel / CSV или откройте воспроизводимый демонабор с остатками и поставщиками."><Button onClick={() => loadData(makeDemoData(), { kind: 'demo', name: 'Демонстрационный набор StockPilot' })}><Play size={16} /> Открыть демо</Button></EmptyState>}
        </> : !dataset ? <>
          <PageHeader eyebrow="РАБОЧЕЕ ПРОСТРАНСТВО" title="Решения о закупках — с объяснением" description="StockPilot связывает продажи, регулярный спрос и количество к заказу." />
          <section className={styles.welcome}><div className={styles.welcomeIcon}><Boxes size={30} /></div><h2>Начните с ваших данных</h2><p>Загрузите историю продаж или изучите полный сценарий на демонстрационном ассортименте.</p><div className={styles.welcomeActions}><Button variant="primary" onClick={() => loadData(makeDemoData(), { kind: 'demo', name: 'Демонстрационный набор StockPilot' })}><Play size={16} /> Открыть демо</Button><Button onClick={openImport}><Upload size={16} /> Импортировать Excel / CSV</Button></div><div className={styles.steps}>{[{icon:Database,title:'История продаж',text:'Проверьте исходные данные'},{icon:Activity,title:'Регулярный спрос',text:'Посмотрите найденные всплески'},{icon:Package,title:'Рекомендация',text:'Разберите расчёт количества'},{icon:FileSpreadsheet,title:'Черновик заказа',text:'Выберите позиции и выгрузите'}].map(({icon:Icon,title,text},index)=><div key={title}><span>{String(index+1).padStart(2,'0')}<Icon size={17}/></span><h3>{title}</h3><p>{text}</p></div>)}</div></section>
        </> : section === 'overview' ? <>
          <PageHeader title="Панель пополнения" description={`${recommendations.length} товаров · приоритеты по текущему сценарию`} action={<Button variant="primary" onClick={() => filterTo('order')}>К рекомендациям <ArrowRight size={16} /></Button>} />
          {salesOnly && <Notice tone="warning">Загружены только продажи. Для оценки склада и закупок нужны остатки и условия поставщиков. Подробности — в разделе «Данные».</Notice>}
          <section className={styles.kpiStrip} aria-label="Сводка по всему ассортименту"><Kpi label="Риск дефицита" value={salesOnly ? '—' : summary.risk} description={salesOnly ? 'Нет подтверждённых остатков' : `Товаров с высоким и критическим риском · ${summary.critical} срочных`} /><Kpi label="План закупки" value={salesOnly ? '—' : money(summary.cost)} description="Сумма допустимых рекомендаций" /><Kpi label="Аномальные наблюдения" value={summary.anomalies} description={`В истории ${summary.anomalySkus} товаров, а не число SKU`} /><Kpi label="Требуют проверки" value={summary.quality} description="Товары с проблемами данных или условий" /></section>
          <section className={styles.attention}><div><span className={styles.smallLabel}>ТРЕБУЕТ ВНИМАНИЯ</span><p>Начните с позиций, для которых нужно решение</p></div><div className={styles.attentionItems}>{[{label:'Срочные позиции',value:summary.critical,filter:'urgent' as const},{label:'Нет поставщика',value:summary.supplier,filter:'supplier' as const},{label:'Вне бюджета',value:summary.budget,filter:'budget' as const}].filter(item => item.value > 0).map(item=><button key={item.filter} onClick={() => filterTo(item.filter)}><b>{item.value}</b>{item.label}<ChevronRight size={15}/></button>)}{summary.critical + summary.supplier + summary.budget === 0 && <span className={styles.clearState}><Check size={16}/> Срочных проблем нет</span>}</div></section>
          <section className={styles.attention}><div><span className={styles.smallLabel}>ИИ-ПОМОЩНИК</span><p>Задайте вопрос о рисках и закупках по текущим данным</p></div><Button onClick={() => go('agent')}><Bot size={17} /> Открыть ИИ-агента <ArrowRight size={16} /></Button></section>
          <RecommendationsTable {...tableProps} compact onAll={() => go('recommendations')} />
          <section className={styles.panel}><div className={styles.sectionHeading}><div><h2><BarChart3 size={17}/> Как обоснован заказ</h2><p>От исходной истории до решения о закупке</p></div><Button variant="ghost" onClick={() => go('backtest')}>Проверить на истории <ArrowRight size={15}/></Button></div><div className={styles.explanationFlow}><div><span>01</span><b>Продажи</b><p>{integer(dataset.sales.length)} исходных наблюдений</p></div><ArrowRight size={17}/><div><span>02</span><b>Всплески</b><p>{summary.anomalies} наблюдений отмечено</p></div><ArrowRight size={17}/><div><span>03</span><b>Регулярный прогноз</b><p>Очищенная история и веса недель</p></div><ArrowRight size={17}/><div><span>04</span><b>Количество к заказу</b><p>Позиция, сроки, MOQ и бюджет</p></div></div></section>
        </> : section === 'recommendations' ? <>
          <PageHeader title="Рекомендации" description={`${recommendations.length} товаров · выберите позиции для закупочного черновика`} />
          {salesOnly && <div className={styles.message}><Notice tone="warning">Остатки и условия поставщиков неизвестны. Закупочные действия недоступны; история и её проверка доступны в карточках.</Notice></div>}
          <RecommendationsTable {...tableProps}/>
        </> : section === 'agent' ? <>
          <PageHeader title="ИИ-агент закупок" description="OpenAI выбирает инструменты и объясняет результаты серверного расчёта." />
          <Notice tone="info">Агент использует загруженный набор данных. Параметры раздела «Сценарии» не переносятся сюда: бюджет и задержку укажите в вопросе. Заказы автоматически не отправляются.</Notice>
          <label>Товар для объяснения <select aria-label="Товар для ИИ-агента" value={historySku} onChange={event => setHistorySku(event.target.value)}>{dataset.products.map(product => <option key={product.sku} value={product.sku}>{product.sku} · {product.productName}</option>)}</select></label>
          <AgentWorkspace dataset={dataset} selectedSku={historySku} onSelectSku={sku => { if (dataset.products.some(product => product.sku === sku)) setSelectedSku(sku); }} />
        </> : section === 'scenarios' ? <ScenarioPanel key={revision} scenario={scenario} base={base} current={recommendations} salesOnly={salesOnly} onApply={value => { setScenario(value); setMessage({ text:'Сценарий применён. Рекомендации, показатели и открываемые карточки обновлены. Существующий черновик нужно пересмотреть.', tone:'success' }); }} onOpen={setSelectedSku} />
        : section === 'backtest' ? <HistoryPanel dataset={dataset} recommendations={recommendations} sourceLabel={source?.kind === 'demo' ? 'Демо-данные основного приложения · 36 недель' : `Импортированный файл: ${source?.name}`} sku={historySku} onSku={setHistorySku} dataRevision={dataRevision}/>
        : <DraftPanel draft={draft} revision={revision} onReview={reviewDraft} onRecommendations={() => go('recommendations')} onMessage={(text,tone)=>setMessage({text,tone})}/>}
      </main>
    </div>
    {selectedItem && dataset && <SkuDrawer item={selectedItem} dataset={dataset} revision={revision} salesOnly={salesOnly} onClose={()=>setSelectedSku(null)} onSelect={sku=>{ if (!selectedSkus.includes(sku) && orderBlockReason(selectedItem,salesOnly)) return; selectSku(sku); }} selected={selectedSkus.includes(selectedItem.sku)} />}
  </div>;
}
