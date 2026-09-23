import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { analyzeDataset, explanationFor } from "../analytics";
import type { Recommendation } from "../types";
import { requestNvidiaReview } from "./adapters/nvidia";
import { DEFAULT_SCENARIO, POLICY_VERSION, type AgentFact, type AgentScenario, type ProcurementPlan, type ToolEnvelope } from "./contracts";
import { createDraft, createPlan, planCacheKey, type AgentSession } from "./session/store";

export interface FunctionToolDefinition { type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: true; }
type ArgsSchema = z.ZodType<Record<string, unknown>>;
type Tool = { definition: FunctionToolDefinition; schema: ArgsSchema; run: (args: Record<string, unknown>, session: AgentSession) => Promise<ToolEnvelope> };

const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const string = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const number = (description: string, extra: Record<string, unknown> = {}) => ({ type: ["number", "null"], description, ...extra });
const nullableString = (description: string) => ({ type: ["string", "null"], description });
const toolId = (toolName: string) => `${toolName}:${randomUUID()}`;
const revision = (session: AgentSession) => session.datasetRevision ?? "unknown";
const now = () => new Date().toISOString();
const fact = (session: AgentSession, resultId: string, entityId: string, key: string, value: AgentFact["value"], unit: string | null, origin: AgentFact["origin"] = "calculation", calculationId?: string): AgentFact => ({ id: `${resultId}:${entityId}:${key}`, entityId, key, value, unit, origin, datasetRevision: revision(session), calculationId });
const envelope = <T>(session: AgentSession, toolName: string, status: ToolEnvelope<T>["status"], data: T, options: Partial<Omit<ToolEnvelope<T>, "status" | "toolName" | "datasetRevision" | "data" | "resultId" | "scope" | "facts" | "assumptions" | "warnings">> & { scope?: string; facts?: AgentFact[]; assumptions?: string[]; warnings?: string[]; resultId?: string } = {}): ToolEnvelope<T> => ({ status, toolName, datasetRevision: revision(session), scope: options.scope ?? "session", resultId: options.resultId ?? toolId(toolName), data, facts: options.facts ?? [], assumptions: options.assumptions ?? [], warnings: options.warnings ?? [], errorCode: options.errorCode });
const error = (session: AgentSession, toolName: string, errorCode: string, message: string) => envelope(session, toolName, "error", null, { errorCode, warnings: [message] });
const currentDataset = (session: AgentSession, toolName: string) => session.dataset ? session.dataset : error(session, toolName, "DATASET_NOT_READY", "Сначала загрузите dataset в текущую сессию.");
const plan = (session: AgentSession, id: unknown, toolName: string) => {
  if (typeof id !== "string") return error(session, toolName, "PLAN_ID_REQUIRED", "Для действия нужна версия плана.");
  const value = session.plans.get(id);
  if (!value) return error(session, toolName, "PLAN_NOT_FOUND", "План не найден в текущей сессии.");
  if (value.stale || value.datasetRevision !== session.datasetRevision) return error(session, toolName, "PLAN_STALE", "План относится к устаревшей версии dataset.");
  return value;
};
const recommendation = (session: AgentSession, sku: unknown, requestedPlanId: unknown, toolName: string): Recommendation | ToolEnvelope => {
  if (typeof sku !== "string") return error(session, toolName, "SKU_REQUIRED", "Нужен SKU товара.");
  const selectedPlan = requestedPlanId ? plan(session, requestedPlanId, toolName) : undefined;
  if (selectedPlan && "status" in selectedPlan) return selectedPlan;
  const dataset = currentDataset(session, toolName);
  if ("status" in dataset) return dataset;
  const items = selectedPlan?.items ?? analyzeDataset(dataset, DEFAULT_SCENARIO);
  const item = items.find(value => value.sku === sku);
  return item ?? error(session, toolName, "SKU_NOT_FOUND", "SKU не найден в текущем dataset.");
};
const overview = (value: ProcurementPlan) => ({
  planId: value.id, planHash: value.hash, scenario: value.scenario,
  totalCost: value.items.reduce((sum, item) => sum + item.estimatedCost, 0),
  totalQuantity: value.items.reduce((sum, item) => sum + item.recommendedQuantity, 0),
  orderableSkus: value.items.filter(item => item.recommendedQuantity > 0 && item.selectedSupplier).length,
  excludedSkus: value.items.filter(item => item.warnings.some(warning => warning.includes("бюджет"))).map(item => ({ sku: item.sku, productName: item.productName, warning: item.warnings.find(warning => warning.includes("бюджет")) })),
  items: value.items.filter(item => item.recommendedQuantity > 0 || item.stockoutRisk === "critical").slice(0, 30).map(item => ({ sku: item.sku, productName: item.productName, quantity: item.recommendedQuantity, estimatedCost: item.estimatedCost, supplier: item.selectedSupplier?.supplierName ?? null, status: item.recommendationStatus })),
});

const registry: Record<string, Tool> = {
  get_dataset_summary: {
    definition: { type: "function", name: "get_dataset_summary", description: "Return factual quality, period and coverage summary for the current procurement dataset.", parameters: object({}), strict: true }, schema: z.object({}).strict(),
    async run(_, session) {
      const dataset = currentDataset(session, "get_dataset_summary"); if ("status" in dataset) return dataset;
      const resultId = toolId("get_dataset_summary");
      const historyStart = dataset.sales.reduce((first, sale) => sale.date < first ? sale.date : first, dataset.sales[0]?.date ?? null);
      const historyEnd = session.asOfDate ?? null;
      const knownInventory = new Set(dataset.inventory.map(item => item.sku));
      const sourced = new Set(dataset.suppliers.map(item => item.sku));
      const criticalRecommendations = analyzeDataset(dataset, DEFAULT_SCENARIO).filter(item => item.stockoutRisk === "critical").sort((a, b) => a.daysOfCover - b.daysOfCover);
      const urgentProducts = criticalRecommendations.slice(0, 3).map(item => ({ sku: item.sku, productName: item.productName, daysOfCover: item.daysOfCover, recommendedQuantity: item.recommendedQuantity, recommendationStatus: item.recommendationStatus }));
      const warnings = [knownInventory.size < dataset.products.length ? "У части SKU отсутствуют остатки: агент не считает их нулевыми." : "", sourced.size < dataset.products.length ? "У части SKU нет условий поставщика." : ""].filter(Boolean);
      return envelope(session, "get_dataset_summary", warnings.length ? "warning" : "success", { skuCount: dataset.products.length, salesRows: dataset.sales.length, historyStart, historyEnd, inventoryCoverage: knownInventory.size, supplierCoverage: sourced.size, criticalRiskCount: criticalRecommendations.length, urgentProducts }, { scope: "dataset", resultId, warnings, facts: [fact(session, resultId, "dataset", "skuCount", dataset.products.length, "SKU", "input"), fact(session, resultId, "dataset", "historyStart", historyStart, null, "input"), fact(session, resultId, "dataset", "historyEnd", historyEnd, null, "input"), fact(session, resultId, "dataset", "inventoryCoverage", knownInventory.size, "SKU", "input"), fact(session, resultId, "dataset", "supplierCoverage", sourced.size, "SKU", "input"), fact(session, resultId, "dataset", "criticalRiskCount", criticalRecommendations.length, "SKU", "calculation")] });
    },
  },
  search_products: {
    definition: { type: "function", name: "search_products", description: "Find products by SKU, product name or category in the current dataset. Use this before selecting an ambiguous product.", parameters: object({ query: string("Text fragment from user request"), limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum candidates" } }), strict: true }, schema: z.object({ query: z.string().trim().min(1).max(240), limit: z.number().int().min(1).max(20) }).strict(),
    async run(args, session) {
      const dataset = currentDataset(session, "search_products"); if ("status" in dataset) return dataset;
      const query = String(args.query).toLocaleLowerCase("ru-RU"); const limit = Number(args.limit);
      const results = dataset.products.filter(item => `${item.sku} ${item.productName} ${item.category}`.toLocaleLowerCase("ru-RU").includes(query)).slice(0, limit);
      const resultId = toolId("search_products");
      return envelope(session, "search_products", results.length ? "success" : "warning", { candidates: results }, { scope: "catalog", resultId, warnings: results.length ? [] : ["Совпадений не найдено; не подменяйте SKU близким названием."], facts: results.map(item => fact(session, resultId, item.sku, "productName", item.productName, null, "input")) });
    },
  },
  get_sku_details: {
    definition: { type: "function", name: "get_sku_details", description: "Return calculated details for a known SKU. Quantities are facts from deterministic calculations, not model estimates.", parameters: object({ sku: string("Exact SKU"), planId: nullableString("Optional current plan ID; null means baseline calculation") }), strict: true }, schema: z.object({ sku: z.string().min(1), planId: z.string().uuid().nullable() }).strict(),
    async run(args, session) {
      const item = recommendation(session, args.sku, args.planId, "get_sku_details"); if ("status" in item) return item;
      const resultId = toolId("get_sku_details");
      return envelope(session, "get_sku_details", item.warnings.length ? "warning" : "success", { sku: item.sku, productName: item.productName, historyPoints: item.rawHistory.length, forecastDemand: item.forecastDemand, stockPosition: item.inventoryKnown ? item.stockPosition : null, inTransit: item.inTransit, supplier: item.selectedSupplier ? { supplierId: item.selectedSupplier.supplierId, supplierName: item.selectedSupplier.supplierName, leadTimeDays: item.leadTimeDays, unitCost: item.selectedSupplier.unitCost } : null, warnings: item.warnings }, { scope: item.sku, resultId, warnings: item.warnings, facts: [fact(session, resultId, item.sku, "forecastDemand", item.forecastDemand, "шт./нед.", "calculation"), fact(session, resultId, item.sku, "stockPosition", item.inventoryKnown ? item.stockPosition : null, "шт.", "input"), fact(session, resultId, item.sku, "inTransit", item.inTransit, "шт.", "input")] });
    },
  },
  get_recommendation_breakdown: {
    definition: { type: "function", name: "get_recommendation_breakdown", description: "Explain an existing deterministic recommendation: demand, safety stock, MOQ, pack size, budget and warnings. Never recalculate in text.", parameters: object({ sku: string("Exact SKU"), planId: nullableString("Plan ID or null for baseline") }), strict: true }, schema: z.object({ sku: z.string().min(1), planId: z.string().uuid().nullable() }).strict(),
    async run(args, session) {
      const item = recommendation(session, args.sku, args.planId, "get_recommendation_breakdown"); if ("status" in item) return item;
      const resultId = toolId("get_recommendation_breakdown");
      return envelope(session, "get_recommendation_breakdown", item.warnings.length ? "warning" : "success", { sku: item.sku, productName: item.productName, explanation: explanationFor(item), forecastDemand: item.forecastDemand, safetyStock: item.safetyStock, reorderPoint: item.reorderPoint, targetStock: item.targetStock, stockPosition: item.inventoryKnown ? item.stockPosition : null, rawNeed: item.rawRecommendedQuantity, recommendedQuantity: item.recommendedQuantity, minOrderQty: item.minOrderQty, packSize: item.packSize, estimatedCost: item.selectedSupplier ? item.estimatedCost : null }, { scope: item.sku, resultId, warnings: item.warnings, facts: [fact(session, resultId, item.sku, "forecastDemand", item.forecastDemand, "шт./нед."), fact(session, resultId, item.sku, "safetyStock", item.safetyStock, "шт."), fact(session, resultId, item.sku, "reorderPoint", item.reorderPoint, "шт."), fact(session, resultId, item.sku, "recommendedQuantity", item.recommendedQuantity, "шт."), fact(session, resultId, item.sku, "estimatedCost", item.selectedSupplier ? item.estimatedCost : null, "KZT")] });
    },
  },
  calculate_purchase_plan: {
    definition: { type: "function", name: "calculate_purchase_plan", description: "Create an immutable procurement-plan version with the application's deterministic replenishment engine. Use a null argument to preserve the current default value.", parameters: object({ budget: number("Budget in KZT, or null for default", { minimum: 0, maximum: 1000000000 }), demandMultiplier: number("Demand multiplier, or null", { minimum: .5, maximum: 3 }), delayDays: number("Supplier delay in days, or null", { minimum: 0, maximum: 365 }), serviceLevel: number("Service level, or null", { minimum: .5, maximum: .999 }) }), strict: true }, schema: z.object({ budget: z.number().min(0).max(1_000_000_000).nullable(), demandMultiplier: z.number().min(.5).max(3).nullable(), delayDays: z.number().int().min(0).max(365).nullable(), serviceLevel: z.number().min(.5).max(.999).nullable() }).strict(),
    async run(args, session) {
      const dataset = currentDataset(session, "calculate_purchase_plan"); if ("status" in dataset) return dataset;
      const scenario: AgentScenario = { budget: args.budget === null ? DEFAULT_SCENARIO.budget : Number(args.budget), demandMultiplier: args.demandMultiplier === null ? DEFAULT_SCENARIO.demandMultiplier : Number(args.demandMultiplier), delayDays: args.delayDays === null ? DEFAULT_SCENARIO.delayDays : Number(args.delayDays), serviceLevel: args.serviceLevel === null ? DEFAULT_SCENARIO.serviceLevel : Number(args.serviceLevel) };
      const hash = planCacheKey(revision(session), scenario);
      const existing = [...session.plans.values()].find(item => item.hash === hash && !item.stale);
      const calculated = existing ?? createPlan(session, { hash, datasetRevision: revision(session), asOfDate: session.asOfDate ?? now().slice(0, 10), policyVersion: POLICY_VERSION, scenario, items: analyzeDataset(dataset, scenario) });
      const resultId = toolId("calculate_purchase_plan"); const data = overview(calculated);
      const warnings = calculated.items.flatMap(item => item.warnings).filter((value, index, values) => values.indexOf(value) === index).slice(0, 8);
      return envelope(session, "calculate_purchase_plan", warnings.length ? "warning" : "success", { ...data, cached: Boolean(existing) }, { scope: "plan", resultId, warnings, facts: [fact(session, resultId, calculated.id, "planTotalCost", data.totalCost, "KZT", "calculation", calculated.id), fact(session, resultId, calculated.id, "orderableSkus", data.orderableSkus, "SKU", "calculation", calculated.id), fact(session, resultId, calculated.id, "budget", scenario.budget, "KZT", "assumption", calculated.id)] });
    },
  },
  simulate_scenario: {
    definition: { type: "function", name: "simulate_scenario", description: "Create a separate plan version from a baseline plan with allowed demand, delay, service-level or budget changes. It never mutates the baseline.", parameters: object({ baselinePlanId: string("Existing baseline plan ID"), budget: number("New budget or null", { minimum: 0, maximum: 1000000000 }), demandMultiplier: number("New demand multiplier or null", { minimum: .5, maximum: 3 }), delayDays: number("New total delay days or null", { minimum: 0, maximum: 365 }), serviceLevel: number("New service level or null", { minimum: .5, maximum: .999 }) }), strict: true }, schema: z.object({ baselinePlanId: z.string().uuid(), budget: z.number().min(0).max(1_000_000_000).nullable(), demandMultiplier: z.number().min(.5).max(3).nullable(), delayDays: z.number().int().min(0).max(365).nullable(), serviceLevel: z.number().min(.5).max(.999).nullable() }).strict(),
    async run(args, session) {
      const baseline = plan(session, args.baselinePlanId, "simulate_scenario"); if ("status" in baseline) return baseline;
      return registry.calculate_purchase_plan.run({ budget: args.budget ?? baseline.scenario.budget, demandMultiplier: args.demandMultiplier ?? baseline.scenario.demandMultiplier, delayDays: args.delayDays ?? baseline.scenario.delayDays, serviceLevel: args.serviceLevel ?? baseline.scenario.serviceLevel }, session).then(value => ({ ...value, toolName: "simulate_scenario", scope: `scenario:${baseline.id}`, data: { baselinePlanId: baseline.id, alternative: value.data } }));
    },
  },
  compare_plans: {
    definition: { type: "function", name: "compare_plans", description: "Deterministically compare two plan versions from this session.", parameters: object({ baselinePlanId: string("Baseline plan ID"), alternativePlanId: string("Alternative plan ID") }), strict: true }, schema: z.object({ baselinePlanId: z.string().uuid(), alternativePlanId: z.string().uuid() }).strict(),
    async run(args, session) {
      const baseline = plan(session, args.baselinePlanId, "compare_plans"); if ("status" in baseline) return baseline; const alternative = plan(session, args.alternativePlanId, "compare_plans"); if ("status" in alternative) return alternative;
      const resultId = toolId("compare_plans"); const prior = new Map(baseline.items.map(item => [item.sku, item]));
      const changes = alternative.items.map(item => { const before = prior.get(item.sku); return { sku: item.sku, productName: item.productName, quantityDelta: item.recommendedQuantity - (before?.recommendedQuantity ?? 0), costDelta: item.estimatedCost - (before?.estimatedCost ?? 0) }; }).filter(item => item.quantityDelta !== 0 || item.costDelta !== 0).slice(0, 40);
      const baselineCost = baseline.items.reduce((sum, item) => sum + item.estimatedCost, 0); const alternativeCost = alternative.items.reduce((sum, item) => sum + item.estimatedCost, 0);
      return envelope(session, "compare_plans", "success", { baselinePlanId: baseline.id, alternativePlanId: alternative.id, costDelta: alternativeCost - baselineCost, changes }, { scope: "plans", resultId, facts: [fact(session, resultId, alternative.id, "costDelta", alternativeCost - baselineCost, "KZT", "calculation")] });
    },
  },
  analyze_budget_coverage: {
    definition: { type: "function", name: "analyze_budget_coverage", description: "Show what the plan funds and excludes under its explicit budget; zero is a real zero budget, never unlimited.", parameters: object({ planId: string("Plan ID") }), strict: true }, schema: z.object({ planId: z.string().uuid() }).strict(),
    async run(args, session) {
      const value = plan(session, args.planId, "analyze_budget_coverage"); if ("status" in value) return value; const resultId = toolId("analyze_budget_coverage"); const spent = value.items.reduce((sum, item) => sum + item.estimatedCost, 0); const excluded = value.items.filter(item => item.warnings.some(warning => warning.includes("бюджет"))).map(item => ({ sku: item.sku, productName: item.productName, rawNeed: item.rawRecommendedQuantity }));
      return envelope(session, "analyze_budget_coverage", excluded.length ? "warning" : "success", { budget: value.scenario.budget, spent, remaining: value.scenario.budget - spent, excluded }, { scope: value.id, resultId, warnings: excluded.length ? ["Часть позиций не вошла в бюджет."] : [], facts: [fact(session, resultId, value.id, "budget", value.scenario.budget, "KZT", "assumption"), fact(session, resultId, value.id, "spent", spent, "KZT"), fact(session, resultId, value.id, "remaining", value.scenario.budget - spent, "KZT")] });
    },
  },
  compare_supplier_options: {
    definition: { type: "function", name: "compare_supplier_options", description: "Compare only known supplier terms for one SKU; it does not change a confirmed order.", parameters: object({ sku: string("Exact SKU") }), strict: true }, schema: z.object({ sku: z.string().min(1) }).strict(),
    async run(args, session) {
      const sku = args.sku as string; const dataset = currentDataset(session, "compare_supplier_options"); if ("status" in dataset) return dataset; const options = dataset.suppliers.filter(item => item.sku === sku).sort((a, b) => a.unitCost - b.unitCost || b.reliabilityScore - a.reliabilityScore); const resultId = toolId("compare_supplier_options");
      return envelope(session, "compare_supplier_options", options.length ? "success" : "warning", { sku, options }, { scope: sku, resultId, warnings: options.length ? [] : ["Для SKU нет сопоставимых условий поставщиков."], facts: options.map(item => fact(session, resultId, item.supplierId, "unitCost", item.unitCost, "KZT", "input")) });
    },
  },
  request_nvidia_review: {
    definition: { type: "function", name: "request_nvidia_review", description: "Request review for a specific, current plan version through the separate NVIDIA module. This never replaces calculations.", parameters: object({ planId: string("Plan ID") }), strict: true }, schema: z.object({ planId: z.string().uuid() }).strict(),
    async run(args, session) {
      const value = plan(session, args.planId, "request_nvidia_review"); if ("status" in value) return value; const resultId = toolId("request_nvidia_review"); const review = await requestNvidiaReview({ planId: value.id, planHash: value.hash, datasetRevision: value.datasetRevision, items: value.items.map(item => ({ sku: item.sku, quantity: item.recommendedQuantity, supplierId: item.selectedSupplier?.supplierId ?? null, estimatedCost: item.estimatedCost })) });
      return envelope(session, "request_nvidia_review", review.status, review, { scope: value.id, resultId, warnings: review.warnings ?? (review.summary ? [review.summary] : []), errorCode: review.errorCode });
    },
  },
  get_backtest_summary: {
    definition: { type: "function", name: "get_backtest_summary", description: "Return only actually available backtest results. Never call forecast-only validation a full portfolio backtest.", parameters: object({}), strict: true }, schema: z.object({}).strict(),
    async run(_, session) { return envelope(session, "get_backtest_summary", "unavailable", { available: false }, { scope: "backtest", warnings: ["Проверка полной системы пока недоступна в агентном API. Доступна отдельная SKU-проверка в разделе Backtest."], errorCode: "PORTFOLIO_BACKTEST_UNAVAILABLE" }); },
  },
  draft_purchase_order: {
    definition: { type: "function", name: "draft_purchase_order", description: "Create an unconfirmed purchase-order draft grouped by supplier for a current plan. It never sends an order.", parameters: object({ planId: string("Plan ID") }), strict: true }, schema: z.object({ planId: z.string().uuid() }).strict(),
    async run(args, session) {
      const value = plan(session, args.planId, "draft_purchase_order"); if ("status" in value) return value;
      const bySupplier: Record<string, { supplierId: string; supplierName: string; items: Recommendation[]; totalCost: number }> = {};
      for (const item of value.items.filter(candidate => candidate.recommendedQuantity > 0 && candidate.selectedSupplier)) { const supplier = item.selectedSupplier!; const group = bySupplier[supplier.supplierId] ?? { supplierId: supplier.supplierId, supplierName: supplier.supplierName, items: [], totalCost: 0 }; group.items.push(item); group.totalCost += item.estimatedCost; bySupplier[supplier.supplierId] = group; }
      const groups = Object.values(bySupplier);
      const draft = createDraft(session, { planId: value.id, planHash: value.hash, datasetRevision: value.datasetRevision, groups }); const resultId = toolId("draft_purchase_order");
      return envelope(session, "draft_purchase_order", groups.length ? "warning" : "warning", { draftId: draft.id, planId: draft.planId, suppliers: draft.groups.map(group => ({ supplierId: group.supplierId, supplierName: group.supplierName, lines: group.items.length, totalCost: group.totalCost })), confirmedAt: draft.confirmedAt }, { scope: draft.id, resultId, warnings: [groups.length ? "Черновик создан. Перед экспортом требуется явное подтверждение." : "Нет позиций для черновика."], facts: [fact(session, resultId, draft.id, "supplierDraftCount", groups.length, "поставщик", "calculation", draft.id)] });
    },
  },
  draft_supplier_message: {
    definition: { type: "function", name: "draft_supplier_message", description: "Prepare a neutral supplier message from a verified unconfirmed draft; it does not send email.", parameters: object({ draftId: string("Draft ID") }), strict: true }, schema: z.object({ draftId: z.string().uuid() }).strict(),
    async run(args, session) {
      const draftId = args.draftId as string; const draft = session.drafts.get(draftId); if (!draft) return error(session, "draft_supplier_message", "DRAFT_NOT_FOUND", "Черновик не найден в текущей сессии."); if (draft.datasetRevision !== session.datasetRevision) return error(session, "draft_supplier_message", "DRAFT_STALE", "Черновик относится к устаревшему dataset.");
      const resultId = toolId("draft_supplier_message"); const messages = draft.groups.map(group => ({ supplierId: group.supplierId, supplierName: group.supplierName, subject: `Черновик заказа StockPilot · ${draft.id.slice(0, 8)}`, body: `Здравствуйте!\n\nПросим подтвердить возможность поставки следующих позиций:\n${group.items.map(item => `• ${item.productName} (${item.sku}) — ${item.recommendedQuantity} шт.`).join("\n")}\n\nЭто черновик, он не является отправленным заказом.` }));
      return envelope(session, "draft_supplier_message", "warning", { draftId: draft.id, messages }, { scope: draft.id, resultId, warnings: ["Письма подготовлены, но не отправлены."], facts: [fact(session, resultId, draft.id, "messageCount", messages.length, "письмо", "calculation")] });
    },
  },
  generate_procurement_report: {
    definition: { type: "function", name: "generate_procurement_report", description: "Generate a traceable report payload from an existing plan and its assumptions.", parameters: object({ planId: string("Plan ID") }), strict: true }, schema: z.object({ planId: z.string().uuid() }).strict(),
    async run(args, session) {
      const value = plan(session, args.planId, "generate_procurement_report"); if ("status" in value) return value; const resultId = toolId("generate_procurement_report"); const data = overview(value);
      return envelope(session, "generate_procurement_report", "success", { reportId: randomUUID(), generatedAt: now(), datasetRevision: value.datasetRevision, asOfDate: value.asOfDate, policyVersion: value.policyVersion, plan: data, assumptions: ["Прогноз: взвешенное скользящее среднее за 8 недель.", "MOQ и упаковка применяются детерминированно.", "Фактическая отправка заказа не подключена."] }, { scope: value.id, resultId, facts: [fact(session, resultId, value.id, "reportPlanCost", data.totalCost, "KZT", "calculation")] });
    },
  },
  propose_workspace_action: {
    definition: { type: "function", name: "propose_workspace_action", description: "Propose a non-destructive UI action such as opening an SKU or plan comparison. This is never an external side effect.", parameters: object({ action: { type: "string", enum: ["open_sku", "show_comparison", "show_draft", "show_budget"], description: "UI action" }, sku: nullableString("SKU for open_sku, otherwise null") }), strict: true }, schema: z.object({ action: z.enum(["open_sku", "show_comparison", "show_draft", "show_budget"]), sku: z.string().nullable() }).strict(),
    async run(args, session) { return envelope(session, "propose_workspace_action", "success", args, { scope: "ui", facts: [] }); },
  },
};

export function selectToolDefinitions(question: string): FunctionToolDefinition[] {
  const value = question.toLocaleLowerCase("ru-RU");
  const names = new Set<string>(["get_dataset_summary"]);
  if (/найди|поиск|sku|товар/.test(value)) names.add("search_products");
  if (/почему|объясн|сколько/.test(value)) ["get_sku_details", "get_recommendation_breakdown", "propose_workspace_action"].forEach(name => names.add(name));
  if (/закуп|план|бюджет|задерж|спрос|сценар/.test(value)) ["calculate_purchase_plan", "simulate_scenario", "compare_plans", "analyze_budget_coverage"].forEach(name => names.add(name));
  if (/поставщик/.test(value)) names.add("compare_supplier_options");
  if (/nvidia|провер/.test(value)) names.add("request_nvidia_review");
  if (/чернов|заказ|письм/.test(value)) ["calculate_purchase_plan", "draft_purchase_order", "draft_supplier_message"].forEach(name => names.add(name));
  if (/отч[её]т|backtest|бэктест/.test(value)) ["generate_procurement_report", "get_backtest_summary"].forEach(name => names.add(name));
  return [...names].map(name => registry[name]!.definition);
}

export async function executeTool(name: string, rawArguments: unknown, session: AgentSession): Promise<ToolEnvelope> {
  const tool = registry[name]; if (!tool) return error(session, name, "UNKNOWN_TOOL", "Инструмент не разрешён для этого запуска.");
  const parsed = tool.schema.safeParse(rawArguments);
  if (!parsed.success) return error(session, name, "INVALID_TOOL_ARGUMENTS", "Модель вернула аргументы, не прошедшие проверку схемы.");
  return tool.run(parsed.data, session);
}

export const getToolByName = (name: string) => registry[name];
