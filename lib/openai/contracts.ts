import { z } from "zod";
import type { Dataset, Recommendation, Scenario } from "../types";

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const nonEmpty = z.string().trim().min(1).max(240);

export const DatasetSchema = z.object({
  sales: z.array(z.object({ date: z.string().min(8).max(32), sku: nonEmpty, productName: nonEmpty, quantity: nonNegative, category: nonEmpty, promotionFlag: z.boolean().optional() })).max(50_000),
  inventory: z.array(z.object({ sku: nonEmpty, onHand: nonNegative, reserved: nonNegative, backorders: nonNegative })).max(10_000),
  transit: z.array(z.object({ sku: nonEmpty, quantity: nonNegative, eta: z.string().min(8).max(32), supplierId: nonEmpty })).max(10_000),
  suppliers: z.array(z.object({ supplierId: nonEmpty, supplierName: nonEmpty, sku: nonEmpty, leadTimeDays: z.number().int().nonnegative().max(3650), unitCost: nonNegative, minOrderQty: z.number().int().nonnegative(), packSize: z.number().int().positive(), reliabilityScore: finite.min(0).max(100) })).max(20_000),
  products: z.array(z.object({ sku: nonEmpty, productName: nonEmpty, category: nonEmpty, criticality: z.number().int().min(0).max(10) })).min(1).max(10_000),
}).strict();
export type AgentDataset = z.infer<typeof DatasetSchema> & Dataset;

export const ScenarioSchema = z.object({
  demandMultiplier: finite.min(.5).max(3),
  delayDays: z.number().int().min(0).max(365),
  serviceLevel: finite.min(.5).max(.999),
  budget: nonNegative.max(1_000_000_000),
}).strict();
export type AgentScenario = z.infer<typeof ScenarioSchema> & Scenario;

export const AgentRunRequestSchema = z.object({
  action: z.enum(["initialize", "run", "clear"]).default("run"),
  sessionId: z.string().uuid().optional(),
  dataset: DatasetSchema.optional(),
  question: z.string().trim().min(1).max(1_500).optional(),
  selectedSku: z.string().trim().min(1).max(240).nullable().optional(),
  activePlanId: z.string().uuid().nullable().optional(),
  scenario: ScenarioSchema.optional(),
}).strict();
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentToolStatusSchema = z.enum(["success", "warning", "unavailable", "error"]);
export type AgentToolStatus = z.infer<typeof AgentToolStatusSchema>;
export type FactOrigin = "input" | "calculation" | "backtest" | "assumption";
export interface AgentFact {
  id: string;
  entityId: string;
  key: string;
  value: string | number | boolean | null;
  unit: string | null;
  origin: FactOrigin;
  datasetRevision: string;
  calculationId?: string;
}
export interface ToolEnvelope<T = unknown> {
  status: AgentToolStatus;
  toolName: string;
  datasetRevision: string;
  scope: string;
  resultId: string;
  data: T;
  facts: AgentFact[];
  assumptions: string[];
  warnings: string[];
  errorCode?: string;
}

export type AgentEventType = "run_started" | "tool_started" | "tool_finished" | "review_started" | "review_finished" | "scenario_finished" | "answer_ready" | "confirmation_required" | "warning" | "error" | "run_finished";
export interface AgentEvent {
  runId: string;
  eventId: string;
  sequence: number;
  timestamp: string;
  status: "running" | "success" | "warning" | "error" | "cancelled";
  type: AgentEventType;
  toolName?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ProcurementPlan {
  id: string;
  hash: string;
  datasetRevision: string;
  asOfDate: string;
  policyVersion: string;
  scenario: AgentScenario;
  items: Recommendation[];
  createdAt: string;
  stale: boolean;
}

export interface PurchaseDraft {
  id: string;
  planId: string;
  planHash: string;
  datasetRevision: string;
  createdAt: string;
  confirmedAt: string | null;
  groups: Array<{ supplierId: string; supplierName: string; items: Recommendation[]; totalCost: number }>;
}

export const DEFAULT_SCENARIO: AgentScenario = { demandMultiplier: 1, delayDays: 0, serviceLevel: .95, budget: 1_500_000 };
export const POLICY_VERSION = "stockpilot-replenishment-v1";
