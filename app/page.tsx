"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDownToLine, Bot, Boxes, ChevronRight, CircleCheck, FileSpreadsheet, Filter, Loader2, PackageCheck, Play, Search, Send, ShoppingCart, SlidersHorizontal, Sparkles, Upload, X, Zap,
} from "lucide-react";
import * as XLSX from "xlsx";
import { analyzeDataset } from "../lib/analytics";
import { makeDemoData } from "../lib/demo-data";
import type { Dataset, Recommendation, Scenario, Status } from "../lib/types";

const initialScenario: Scenario = { demandMultiplier: 1, delayDays: 0, serviceLevel: .95, budget: 1_500_000 };
const currency = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const statusClass: Record<Status, string> = {
  "Заказать срочно": "critical", "Запланировать заказ": "high", "Заказ не требуется": "healthy", "Избыточный запас": "overstock", "Требуется проверка": "review", "Недостаточно данных": "review", "Нет поставщика": "review",
};
const synonyms: Record<string, string[]> = {
  date: ["дата", "date", "sales date", "дата продажи"], sku: ["sku", "артикул", "код", "код товара", "номенклатура"], productName: ["товар", "наименование", "название", "product", "product name"], quantity: ["количество", "кол-во", "продажи", "qty", "quantity", "units"],
};

function inferMapping(headers: string[]) {
  return Object.fromEntries(Object.entries(synonyms).map(([field, names]) => [field, headers.find(header => names.some(name => header.toLowerCase().includes(name))) || ""]));
}
function safeCsv(value: unknown) { const text = String(value ?? ""); return /^[=+\-@]/.test(text) ? `'${text}` : text; }
function downloadCsv(rows: Recommendation[]) {
  const header = ["Статус", "SKU", "Товар", "Поставщик", "Количество", "Цена", "Сумма", "Ожидаемая дата"];
  const lines = rows.map(item => [item.recommendationStatus, item.sku, item.productName, item.selectedSupplier?.supplierName ?? "", item.recommendedQuantity, item.selectedSupplier?.unitCost ?? 0, item.estimatedCost, item.estimatedStockoutDate ?? ""].map(safeCsv).map(value => `"${value.replaceAll('"', '""')}"`).join(";"));
  const blob = new Blob([[header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "stockpilot-purchase-order.csv"; a.click(); URL.revokeObjectURL(a.href);
}

export default function Home() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [scenario, setScenario] = useState(initialScenario);
  const [filter, setFilter] = useState("Все");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [showOrder, setShowOrder] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [fileRows, setFileRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [agentReply, setAgentReply] = useState("");
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState("");

  const recommendations = useMemo(() => dataset ? analyzeDataset(dataset, scenario) : [], [dataset, scenario]);
  const visible = useMemo(() => recommendations.filter(item => {
    const matchesText = `${item.sku} ${item.productName} ${item.category}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "Все" || (filter === "Критические" && item.recommendationStatus === "Заказать срочно") || (filter === "Заказать" && ["Заказать срочно", "Запланировать заказ"].includes(item.recommendationStatus)) || (filter === "Аномалии" && item.outliers.length > 0) || (filter === "Проверка" && ["Требуется проверка", "Нет поставщика", "Недостаточно данных"].includes(item.recommendationStatus));
    return matchesText && matchesFilter;
  }), [recommendations, filter, search]);
  const kpis = useMemo(() => ({
    sku: recommendations.length,
    critical: recommendations.filter(item => item.recommendationStatus === "Заказать срочно").length,
    anomalies: recommendations.reduce((sum, item) => sum + item.outliers.length, 0),
    orderCost: recommendations.reduce((sum, item) => sum + item.estimatedCost, 0),
    prevented: recommendations.filter(item => item.outliers.length).reduce((sum, item) => sum + Math.max(0, item.naiveForecast - item.forecastDemand) * 4 * (item.selectedSupplier?.unitCost ?? 0), 0),
    confidence: recommendations.length ? Math.round(recommendations.reduce((sum, item) => sum + item.confidenceScore, 0) / recommendations.length) : 0,
  }), [recommendations]);
  const riskData = useMemo(() => [
    { label: "Критичный", value: recommendations.filter(r => r.stockoutRisk === "critical").length, color: "#fb7185" },
    { label: "Высокий", value: recommendations.filter(r => r.stockoutRisk === "high").length, color: "#fbbf24" },
    { label: "Стабильный", value: recommendations.filter(r => r.stockoutRisk === "healthy").length, color: "#34d399" },
    { label: "Проверка", value: recommendations.filter(r => r.stockoutRisk === "review").length, color: "#94a3b8" },
  ], [recommendations]);
  const categoryData = useMemo(() => Object.entries(recommendations.reduce<Record<string, number>>((acc, item) => { acc[item.category] = (acc[item.category] || 0) + item.recommendedQuantity; return acc; }, {})).map(([name, quantity]) => ({ name, quantity })), [recommendations]);

  function loadDemo() { setDataset(makeDemoData()); setScenario(initialScenario); setShowUpload(false); setFileRows([]); setNotice("Демо-данные загружены: 32 SKU и 36 недель истории"); }
  function runAnalysis() { if (!dataset) return loadDemo(); setProcessing(true); window.setTimeout(() => { setProcessing(false); setNotice(`Анализ завершён: ${recommendations.length} SKU обработано`); }, 850); }
  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setNotice("Файл больше 20 МБ. Для демо используйте файл меньшего размера."); return; }
    try {
      const buffer = await file.arrayBuffer(); const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (!rows.length) throw new Error("empty");
      const headers = Object.keys(rows[0]); setFileRows(rows); setMapping(inferMapping(headers)); setFileName(file.name); setShowUpload(true); setNotice(`Файл прочитан: ${rows.length} строк, лист «${workbook.SheetNames[0]}»`);
    } catch { setNotice("Не удалось прочитать файл. Поддерживаются CSV и XLSX с первой строкой заголовков."); }
  }
  function useImportedData() {
    const accepted = fileRows.flatMap((row, index) => {
      const sku = String(row[mapping.sku] ?? "").trim(); const dateValue = row[mapping.date]; const quantity = Number(String(row[mapping.quantity] ?? "").replace(",", "."));
      if (!sku || !dateValue || !Number.isFinite(quantity) || quantity < 0) return [];
      const rawDate = dateValue instanceof Date ? dateValue.toISOString().slice(0, 10) : String(dateValue);
      const date = /^\d{2}\.\d{2}\.\d{4}$/.test(rawDate) ? `${rawDate.slice(6)}-${rawDate.slice(3, 5)}-${rawDate.slice(0, 2)}` : rawDate.slice(0, 10);
      return [{ sku, date, quantity, productName: String(row[mapping.productName] || sku), category: "Импорт" }];
    });
    if (!accepted.length) { setNotice("Не найдено валидных строк: проверьте сопоставление SKU, даты и количества."); return; }
    const base = makeDemoData(); const importedSkus = [...new Map(accepted.map(row => [row.sku, row])).values()];
    setDataset({ ...base, sales: accepted, products: importedSkus.map(row => ({ sku: row.sku, productName: row.productName, category: row.category, criticality: 3 })), inventory: importedSkus.map(row => ({ sku: row.sku, onHand: 0, reserved: 0, backorders: 0 })), transit: [], suppliers: base.suppliers.filter(supplier => importedSkus.some(row => row.sku === supplier.sku)) });
    setShowUpload(false); setNotice(`Импортировано ${accepted.length} валидных строк. Остатки и поставщиков можно дополнить демо-набором.`);
  }
  async function askAgent(question: string) {
    if (!selected) return; setAsking(true);
    const context = { productName: selected.productName, forecastDemand: selected.forecastDemand, stockPosition: selected.stockPosition, reorderPoint: selected.reorderPoint, recommendedQuantity: selected.recommendedQuantity, outliers: selected.outliers.length, supplier: selected.selectedSupplier?.supplierName, cost: selected.estimatedCost };
    try { const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, context }) }); const data = await response.json(); setAgentReply(data.answer); }
    catch { setAgentReply("Не удалось получить ответ. Расчёты и рекомендации остаются доступны в Demo Mode."); }
    finally { setAsking(false); }
  }

  if (!dataset) return <main className="landing">
    <div className="landing-orb orb-one" /><div className="landing-orb orb-two" />
    <header className="landing-header"><div className="brand"><span className="brand-mark"><Boxes size={19} /></span><span>StockPilot <b>AI</b></span></div><span className="mode"><span /> Demo Mode готов</span></header>
    <section className="hero"><div className="eyebrow"><Sparkles size={14} /> Логистика · Электрокомплект</div><h1>Закупки без<br /><em>дорогих ошибок.</em></h1><p>Автономный агент отделяет разовые всплески от реального спроса и готовит объяснимые заказы поставщикам.</p><div className="hero-actions"><button className="button primary" onClick={loadDemo}><Play size={17} fill="currentColor" /> Загрузить демо-данные</button><label className="button secondary"><Upload size={17} /> Загрузить Excel / CSV<input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} /></label></div><div className="proof"><span><CircleCheck size={15} /> Детерминированные расчёты</span><span><CircleCheck size={15} /> Без API-ключа</span><span><CircleCheck size={15} /> 32 SKU · 36 недель</span></div></section>
    <section className="landing-preview"><div className="preview-top"><span>Обнаружена аномалия</span><b>CAB-NYM-3X2.5</b><small>176 шт. · разовая продажа</small></div><div className="mini-chart">▁▂▂▃▂▃▂▂▂▃▂▂<i>█</i>▂▃▂▂▃</div><div className="preview-order"><span>Рекомендуемый заказ</span><strong>90 шт.</strong><small>Вместо наивных 210 шт.</small></div></section>
  </main>;

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><Boxes size={18} /></span><span>StockPilot <b>AI</b></span></div><div className="workspace">Рабочее пространство</div><nav><a className="nav-active"><Zap size={17} /> Обзор</a><a><PackageCheck size={17} /> Рекомендации <b>{kpis.critical}</b></a><a><ShoppingCart size={17} /> Черновики заказов</a><a><SlidersHorizontal size={17} /> Сценарии</a></nav><div className="sidebar-bottom"><div className="agent-card"><span><Bot size={17} /> Агент закупок</span><p>Все числа проверены детерминированными функциями.</p><i><span /> Demo Mode</i></div><button className="text-button" onClick={loadDemo}>↻ Сбросить демо</button></div></aside>
    <section className="content">
      <header className="topbar"><div><p className="breadcrumb">Электрокомплект / Закупки</p><h1>Панель пополнения</h1></div><div className="top-actions"><span className="mode"><span /> Demo Mode</span><label className="icon-button" title="Загрузить данные"><Upload size={18} /><input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} /></label><button className="button dark" onClick={runAnalysis} disabled={processing}>{processing ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />} {processing ? "Анализируем..." : "Запустить анализ"}</button></div></header>
      {notice && <div className="notice"><CircleCheck size={16} /> {notice}<button onClick={() => setNotice("")}><X size={15} /></button></div>}
      {showUpload && <section className="upload-panel"><div className="section-title"><div><span className="eyebrow soft"><FileSpreadsheet size={14} /> Импорт данных</span><h2>{fileName}</h2><p>Проверьте автоматическое сопоставление перед запуском анализа.</p></div><button className="icon-button" onClick={() => setShowUpload(false)}><X size={18} /></button></div><div className="mapping-grid">{Object.entries(synonyms).map(([key]) => <label key={key}><span>{({ date: "Дата", sku: "SKU", productName: "Название", quantity: "Количество" } as Record<string, string>)[key]}</span><select value={mapping[key] || ""} onChange={event => setMapping({ ...mapping, [key]: event.target.value })}><option value="">Не сопоставлено</option>{fileRows[0] && Object.keys(fileRows[0]).map(header => <option key={header}>{header}</option>)}</select></label>)}</div><div className="preview-table"><span>Предпросмотр: {fileRows.length} строк · принято после проверки</span><pre>{JSON.stringify(fileRows.slice(0, 3), null, 2)}</pre></div><div className="row-end"><button className="button secondary" onClick={loadDemo}>Использовать демо вместо этого</button><button className="button dark" onClick={useImportedData}>Подтвердить сопоставление <ChevronRight size={17} /></button></div></section>}
      <section className="kpis"><Kpi label="SKU проанализировано" value={number.format(kpis.sku)} detail="История, остатки, поставщики" icon={<Boxes />} tone="teal" /><Kpi label="Критический дефицит" value={number.format(kpis.critical)} detail="Нужно заказать сейчас" icon={<AlertTriangle />} tone="rose" /><Kpi label="Аномалий найдено" value={number.format(kpis.anomalies)} detail="Исключены из спроса" icon={<Sparkles />} tone="amber" /><Kpi label="Рекомендованный заказ" value={currency.format(kpis.orderCost)} detail={`Уверенность ${kpis.confidence}%`} icon={<ShoppingCart />} tone="violet" /></section>
      <section className="grid-two"><Panel title="Риск дефицита" subtitle="По текущей позиции и срокам поставки"><ResponsiveContainer width="100%" height={230}><BarChart data={riskData}><CartesianGrid vertical={false} stroke="#e8edf1" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#74808e", fontSize: 11 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#74808e", fontSize: 11 }} /><Tooltip cursor={{ fill: "#f5f7f8" }} /><Bar dataKey="value" radius={[7, 7, 2, 2]}>{riskData.map(item => <Cell key={item.label} fill={item.color} />)}</Bar></BarChart></ResponsiveContainer></Panel><Panel title="План закупок по категориям" subtitle="Рекомендуемое количество"><ResponsiveContainer width="100%" height={230}><BarChart layout="vertical" data={categoryData.slice(0, 6)} margin={{ left: 14 }}><CartesianGrid horizontal={false} stroke="#e8edf1" /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={112} tickLine={false} axisLine={false} tick={{ fill: "#74808e", fontSize: 11 }} /><Tooltip /><Bar dataKey="quantity" fill="#0f9b8e" radius={[0, 7, 7, 0]} /></BarChart></ResponsiveContainer></Panel></section>
      <section className="activity"><div className="activity-icon"><Bot size={19} /></div><div><p>AI Agent Activity</p><strong>{kpis.sku} SKU обработано · {kpis.anomalies} выбросов отделено · {kpis.critical} рисков дефицита</strong></div><span>Данные не отправляются в LLM для расчётов</span></section>
      <section className="section-head"><div><h2>Рекомендации к заказу</h2><p>Приоритизированы по риску дефицита, а не только по объёму продаж.</p></div><button className="button secondary" onClick={() => setShowOrder(true)}><ShoppingCart size={17} /> Создать заказ</button></section>
      <div className="filters"><div className="pills">{["Все", "Критические", "Заказать", "Аномалии", "Проверка"].map(item => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><label className="search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="SKU, товар, категория" /></label></div>
      <section className="table-card"><table><thead><tr><th>Статус</th><th>Товар</th><th>Позиция</th><th>Дней запаса</th><th>Прогноз</th><th>Рекомендация</th><th>Поставщик</th><th>Стоимость</th><th /></tr></thead><tbody>{visible.slice(0, 14).map(item => <tr key={item.sku} onClick={() => { setSelected(item); setAgentReply(""); }}><td><span className={`status ${statusClass[item.recommendationStatus]}`}>{item.recommendationStatus}</span></td><td><b>{item.productName}</b><small>{item.sku} · {item.category}</small></td><td>{number.format(item.stockPosition)}</td><td>{item.daysOfCover === 999 ? "—" : `${item.daysOfCover} дн.`}</td><td>{item.forecastDemand.toFixed(1)}<small>шт./нед.</small></td><td><b className="quantity">{number.format(item.recommendedQuantity)} шт.</b></td><td>{item.selectedSupplier?.supplierName ?? "—"}<small>{item.selectedSupplier ? `${item.leadTimeDays} дн.` : item.warnings[0]}</small></td><td>{item.estimatedCost ? currency.format(item.estimatedCost) : "—"}</td><td><ChevronRight size={17} /></td></tr>)}</tbody></table>{visible.length === 0 && <div className="empty">Нет рекомендаций с такими фильтрами.</div>}</section>
      <section className="scenario-card"><div><span className="eyebrow soft"><SlidersHorizontal size={14} /> What-if симулятор</span><h2>Что если поставщик задержится?</h2><p>Сценарий пересчитывает точки заказа и приоритеты без изменения исходных данных.</p></div><div className="scenario-controls"><Range label="Спрос" value={`${Math.round(scenario.demandMultiplier * 100)}%`} min={80} max={150} current={scenario.demandMultiplier * 100} onChange={value => setScenario({ ...scenario, demandMultiplier: value / 100 })} /><Range label="Задержка" value={`+${scenario.delayDays} дн.`} min={0} max={21} current={scenario.delayDays} onChange={value => setScenario({ ...scenario, delayDays: value })} /><Range label="Бюджет" value={currency.format(scenario.budget)} min={250000} max={2500000} step={250000} current={scenario.budget} onChange={value => setScenario({ ...scenario, budget: value })} /></div></section>
    </section>
    {selected && <SkuDrawer item={selected} close={() => setSelected(null)} agentReply={agentReply} asking={asking} askAgent={askAgent} />}
    {showOrder && <OrderDrawer items={recommendations.filter(item => item.recommendedQuantity > 0 && item.selectedSupplier)} close={() => setShowOrder(false)} />}
  </main>;
}

function Kpi({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone: string }) { return <article className="kpi"><span className={`kpi-icon ${tone}`}>{icon}</span><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>; }
function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="panel"><div className="panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div><button className="icon-button"><Filter size={16} /></button></div>{children}</section>; }
function Range({ label, value, min, max, step = 1, current, onChange }: { label: string; value: string; min: number; max: number; step?: number; current: number; onChange: (value: number) => void }) { return <label className="range"><span>{label}<b>{value}</b></span><input type="range" min={min} max={max} step={step} value={current} onChange={event => onChange(Number(event.target.value))} /></label>; }

function SkuDrawer({ item, close, agentReply, asking, askAgent }: { item: Recommendation; close: () => void; agentReply: string; asking: boolean; askAgent: (question: string) => Promise<void> }) {
  const chart = item.rawHistory.map((raw, index) => ({ week: `W${index + 1}`, raw, clean: item.cleanedHistory[index], forecast: index >= item.rawHistory.length - 8 ? item.forecastDemand : undefined, anomaly: item.outliers.some(outlier => outlier.quantity === raw) ? raw : undefined }));
  return <div className="drawer-backdrop" onMouseDown={close}><aside className="drawer" onMouseDown={event => event.stopPropagation()}><header><div><span className={`status ${statusClass[item.recommendationStatus]}`}>{item.recommendationStatus}</span><h2>{item.productName}</h2><p>{item.sku} · {item.category}</p></div><button className="icon-button" onClick={close}><X size={19} /></button></header><section className="recommendation-hero"><p>Рекомендуемый заказ</p><strong>{number.format(item.recommendedQuantity)} <small>шт.</small></strong><span>{item.selectedSupplier?.supplierName ?? "Требуется поставщик"} · {item.selectedSupplier ? currency.format(item.estimatedCost) : "Без цены"}</span></section><section className="detail-chart"><div className="legend"><span><i className="raw" /> Продажи</span><span><i className="clean" /> Очищенная история</span><span><i className="forecast" /> Прогноз</span></div><ResponsiveContainer width="100%" height={220}><LineChart data={chart}><CartesianGrid vertical={false} stroke="#e8edf1" /><XAxis dataKey="week" hide /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#74808e" }} /><Tooltip /><Line dataKey="raw" stroke="#cbd5e1" strokeWidth={1.5} dot={false} /><Line dataKey="clean" stroke="#0f9b8e" strokeWidth={2.5} dot={false} /><Line dataKey="forecast" stroke="#6d5dfc" strokeDasharray="5 4" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>{item.outliers.length > 0 && <div className="outlier-note"><AlertTriangle size={16} /> Всплеск {number.format(item.outliers[0].quantity)} шт. исключён из базового прогноза.</div>}</section><section className="metrics"><Metric label="Точка заказа" value={`${number.format(item.reorderPoint)} шт.`} /><Metric label="Страховой запас" value={`${number.format(item.safetyStock)} шт.`} /><Metric label="В позиции" value={`${number.format(item.stockPosition)} шт.`} /><Metric label="Срок поставки" value={`${item.leadTimeDays} дн.`} /><Metric label="MOQ / упаковка" value={`${item.minOrderQty} / ${item.packSize}`} /><Metric label="Уверенность" value={`${item.confidenceScore}%`} /></section><section className="formula"><h3>Почему именно столько?</h3><p>Целевой запас {number.format(item.targetStock)} − текущая позиция {number.format(item.stockPosition)} = {number.format(item.rawRecommendedQuantity)}. Результат округлён до упаковки {item.packSize} и MOQ {item.minOrderQty}.</p></section><section className="agent-box"><div><Bot size={18} /><b>AI-ассистент</b><span>Числа берёт только из расчёта</span></div>{agentReply ? <p>{agentReply}</p> : <p className="muted">Спросите, почему система выбрала именно такую рекомендацию.</p>}<button className="button dark wide" disabled={asking} onClick={() => askAgent("Почему система рекомендует именно это количество?")}>{asking ? <Loader2 className="spin" size={16} /> : <Send size={16} />} Объяснить рекомендацию</button></section></aside></div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><b>{value}</b></div>; }
function OrderDrawer({ items, close }: { items: Recommendation[]; close: () => void }) { const grouped = Object.values(items.reduce<Record<string, Recommendation[]>>((acc, item) => { const name = item.selectedSupplier?.supplierName || "Без поставщика"; (acc[name] ??= []).push(item); return acc; }, {})); const total = items.reduce((sum, item) => sum + item.estimatedCost, 0); return <div className="drawer-backdrop" onMouseDown={close}><aside className="drawer order-drawer" onMouseDown={event => event.stopPropagation()}><header><div><span className="eyebrow soft"><ShoppingCart size={14} /> Черновики заказов</span><h2>Заказы поставщикам</h2><p>Позиции не отправляются автоматически.</p></div><button className="icon-button" onClick={close}><X size={19} /></button></header>{grouped.map(group => <section className="po-group" key={group[0].selectedSupplier?.supplierId}><h3>{group[0].selectedSupplier?.supplierName}<small>{group[0].selectedSupplier?.reliabilityScore}% надёжности</small></h3>{group.map(item => <div className="po-line" key={item.sku}><span><b>{item.productName}</b><small>{item.sku} · MOQ {item.minOrderQty} · упаковка {item.packSize}</small></span><b>{item.recommendedQuantity} шт.<small>{currency.format(item.estimatedCost)}</small></b></div>)}</section>)}<footer className="order-footer"><div><span>Итого к заказу</span><strong>{currency.format(total)}</strong></div><button className="button dark wide" onClick={() => downloadCsv(items)}><ArrowDownToLine size={17} /> Скачать CSV</button><button className="button secondary wide" onClick={() => navigator.clipboard.writeText(`Тема: Черновик заказа StockPilot\n\n${items.map(item => `${item.productName} — ${item.recommendedQuantity} шт.`).join("\n")}`)}>Копировать текст письма</button></footer></aside></div>; }
