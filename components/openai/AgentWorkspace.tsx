"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, CircleAlert, DatabaseZap, FilePlus2, Loader2, Play, Send, ShieldCheck, Square, Trash2 } from "lucide-react";
import type { Dataset, Recommendation } from "../../lib/types";
import type { AgentEvent, AgentFact } from "../../lib/openai/contracts";
import styles from "./AgentWorkspace.module.css";

type StreamEvent = AgentEvent & { data?: { answer?: string; mode?: "openai" | "local"; model?: string; planId?: string; facts?: AgentFact[]; [key: string]: unknown } };
const quickActions = [
  { label: "Что требует внимания?", question: "Покажи три товара с самым срочным риском." },
  { label: "Объяснить SKU", question: "Почему система рекомендует именно это количество?", selected: true },
  { label: "Составить закупку", question: "Подготовь закупочный план в пределах текущего бюджета." },
  { label: "Проверить задержку", question: "Проверь сценарий задержки поставщика на 7 дней." },
  { label: "Проверить NVIDIA", question: "Проверь текущий план через NVIDIA." },
  { label: "Создать черновики", question: "Подготовь черновики заказов по поставщикам." },
];
const prettyTool = (name?: string) => ({ get_dataset_summary: "сводка данных", search_products: "поиск товаров", get_sku_details: "карточка SKU", get_recommendation_breakdown: "разбор рекомендации", calculate_purchase_plan: "расчёт плана", simulate_scenario: "сценарий", compare_plans: "сравнение", analyze_budget_coverage: "покрытие бюджета", request_nvidia_review: "NVIDIA-review", draft_purchase_order: "черновик заказа", draft_supplier_message: "письмо поставщику", get_backtest_summary: "backtest" }[name ?? ""] ?? name ?? "действие");
const valueText = (value: AgentFact["value"], unit: string | null) => value === null ? "неизвестно" : `${typeof value === "number" ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value) : String(value)}${unit ? ` ${unit}` : ""}`;

export default function AgentWorkspace({ dataset, selectedSku, onSelectSku }: { dataset: Dataset; selectedSku: string | null; onSelectSku: (sku: string) => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null); const [revision, setRevision] = useState(""); const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState(""); const [events, setEvents] = useState<StreamEvent[]>([]); const [facts, setFacts] = useState<AgentFact[]>([]); const [running, setRunning] = useState(false); const [initializing, setInitializing] = useState(false); const [notice, setNotice] = useState(""); const [provider, setProvider] = useState("Готов к запуску"); const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);

  useEffect(() => {
    let active = true; const initialize = async () => {
      setInitializing(true); setNotice(""); setAnswer(""); setEvents([]); setFacts([]); setActivePlanId(null); setProvider("Готов к запуску");
      try {
        const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "initialize", dataset }) });
        const payload = await response.json() as { sessionId?: string; datasetRevision?: string; error?: string };
        if (!response.ok || !payload.sessionId) throw new Error(payload.error ?? "Не удалось подготовить сессию.");
        if (active) { setSessionId(payload.sessionId); setRevision(payload.datasetRevision ?? ""); }
      } catch (cause) { if (active) setNotice(cause instanceof Error ? cause.message : "Не удалось подготовить сессию агента."); }
      finally { if (active) setInitializing(false); }
    };
    void initialize(); return () => { active = false; abortRef.current?.abort(); };
  }, [dataset, sessionVersion]);

  const receive = (event: StreamEvent) => {
    setEvents(previous => [...previous, event].slice(-20));
    if (event.data?.facts) setFacts(previous => [...new Map([...previous, ...event.data!.facts!].map(fact => [fact.id, fact])).values()].slice(-18));
    if (typeof event.data?.planId === "string") setActivePlanId(event.data.planId);
    if (event.type === "answer_ready") { setAnswer(event.data?.answer ?? event.message ?? ""); setProvider(event.data?.mode === "openai" && event.data.model ? `OpenAI · ${event.data.model}` : "Тестовый режим · локальное объяснение"); }
    if (event.type === "error" && event.message) setNotice(event.message);
  };
  const run = async (nextQuestion = question) => {
    if (!sessionId || !nextQuestion.trim() || running) return; setRunning(true); setNotice(""); setAnswer(""); setEvents([]); setFacts([]); const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/agent/stream", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "run", sessionId, dataset, question: nextQuestion.trim(), selectedSku, activePlanId }) });
      if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error ?? "Сервер не открыл поток агента."); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) if (line.trim()) receive(JSON.parse(line) as StreamEvent); }
      if (buffer.trim()) receive(JSON.parse(buffer) as StreamEvent);
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setNotice(cause instanceof Error ? cause.message : "Не удалось получить ответ агента."); }
    finally { abortRef.current = null; setRunning(false); }
  };
  const clear = async () => { if (sessionId) await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear", sessionId }) }); setSessionId(null); setRevision(""); setAnswer(""); setEvents([]); setFacts([]); setActivePlanId(null); setNotice("Данные агентной сессии удалены из памяти сервера."); };

  return <section className={styles.workspace} aria-labelledby="procurement-agent-title">
    <div className={styles.heading}><div><span className={styles.eyebrow}><Bot size={15} /> StockPilot Procurement Agent</span><h2 id="procurement-agent-title">Операционный агент закупок</h2><p>Модель выбирает разрешённые инструменты, а количества и суммы берёт только из серверного расчёта.</p></div><div className={styles.state}><span className={running ? styles.pulse : styles.dot} /> {initializing ? "Подготовка данных" : provider}</div></div>
    <div className={styles.content}>
      <div className={styles.chat}>
        <div className={styles.quick}>{quickActions.map(action => <button key={action.label} type="button" disabled={initializing || running || !sessionId || (Boolean(action.selected) && !selectedSku)} onClick={() => void run(action.question)}>{action.label}</button>)}</div>
        <div className={styles.answer} aria-live="polite">{running ? <div className={styles.thinking}><Loader2 className="spin" size={18} /> Агент выполняет разрешённые действия…</div> : answer ? <><Bot size={18} /><p>{answer}</p></> : <><DatabaseZap size={18} /><p>{initializing ? "Нормализуем dataset и создаём изолированную сессию." : "Задайте задачу обычным языком или выберите быстрый сценарий."}</p></>}</div>
        <div className={styles.composer}><textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="Например: составь закупку на 1,5 млн и проверь через NVIDIA" rows={2} disabled={initializing || running} /><div><span>Версия данных: {revision ? revision.slice(0, 10) : "—"}</span>{running ? <button type="button" className={styles.stop} onClick={() => abortRef.current?.abort()}><Square size={14} /> Остановить</button> : <button type="button" className={styles.send} disabled={!question.trim() || initializing || !sessionId} onClick={() => void run()}><Send size={15} /> Запустить</button>}</div></div>
        {notice && <p className={styles.notice}><CircleAlert size={15} /> {notice}</p>}
        {!sessionId && !initializing && <button type="button" className={styles.send} onClick={() => setSessionVersion(value => value + 1)}>Начать новую сессию</button>}
      </div>
      <aside className={styles.timeline} aria-label="Журнал действий агента"><div className={styles.timelineHead}><div><ShieldCheck size={16} /><b>Журнал действий</b></div><button type="button" title="Удалить данные сессии" onClick={() => void clear()} disabled={running || !sessionId}><Trash2 size={15} /> Очистить</button></div>{events.length ? <ol>{events.map(event => <li key={event.eventId} className={styles[event.status] ?? ""}><span /> <div><b>{prettyTool(event.toolName)}</b><small>{event.message ?? event.type}</small></div></li>)}</ol> : <p className={styles.muted}>Здесь появятся только фактически выполненные действия — скрытые рассуждения модели не показываются.</p>}{facts.length > 0 && <div className={styles.evidence}><b>Источники чисел</b>{facts.slice(-6).map(item => <button type="button" key={item.id} onClick={() => onSelectSku(item.entityId)} disabled={!item.entityId || item.entityId === "dataset"}><span>{item.key}</span><strong>{valueText(item.value, item.unit)}</strong></button>)}</div>}{activePlanId && <div className={styles.plan}><FilePlus2 size={16} /> Версия плана: {activePlanId.slice(0, 8)}</div>}</aside>
    </div>
  </section>;
}
