import { createHash, randomUUID } from "node:crypto";
import type { AgentDataset, AgentScenario, ProcurementPlan, PurchaseDraft } from "../contracts";

export interface AgentSession {
  id: string;
  ownerId: string;
  createdAt: number;
  expiresAt: number;
  dataset?: AgentDataset;
  datasetRevision?: string;
  asOfDate?: string;
  plans: Map<string, ProcurementPlan>;
  drafts: Map<string, PurchaseDraft>;
}

const sessions = new Map<string, AgentSession>();
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
};

export const datasetRevisionFor = (dataset: AgentDataset) => createHash("sha256").update(stable(dataset)).digest("hex").slice(0, 24);

export function purgeExpiredSessions(now = Date.now()) {
  for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
}

export function createSession(ownerId: string, ttlMinutes: number): AgentSession {
  purgeExpiredSessions();
  const now = Date.now();
  const session: AgentSession = { id: randomUUID(), ownerId, createdAt: now, expiresAt: now + ttlMinutes * 60_000, plans: new Map(), drafts: new Map() };
  sessions.set(session.id, session);
  return session;
}

export function getOwnedSession(sessionId: string, ownerId: string): AgentSession | undefined {
  purgeExpiredSessions();
  const session = sessions.get(sessionId);
  return session?.ownerId === ownerId ? session : undefined;
}

export function deleteOwnedSession(sessionId: string, ownerId: string) {
  const session = getOwnedSession(sessionId, ownerId);
  if (!session) return false;
  return sessions.delete(sessionId);
}

export function updateSessionDataset(session: AgentSession, dataset: AgentDataset) {
  const datasetRevision = datasetRevisionFor(dataset);
  if (session.datasetRevision && session.datasetRevision !== datasetRevision) {
    session.plans.forEach(plan => { plan.stale = true; });
    session.drafts.forEach(draft => { draft.confirmedAt = null; });
  }
  session.dataset = dataset;
  session.datasetRevision = datasetRevision;
  session.asOfDate = dataset.sales.reduce((latest, sale) => sale.date > latest ? sale.date : latest, "") || new Date().toISOString().slice(0, 10);
  return datasetRevision;
}

export function createPlan(session: AgentSession, plan: Omit<ProcurementPlan, "id" | "createdAt" | "stale">): ProcurementPlan {
  const result: ProcurementPlan = { ...plan, id: randomUUID(), createdAt: new Date().toISOString(), stale: false };
  session.plans.set(result.id, result);
  return result;
}

export function createDraft(session: AgentSession, draft: Omit<PurchaseDraft, "id" | "createdAt" | "confirmedAt">): PurchaseDraft {
  const existing = [...session.drafts.values()].find(item => item.planHash === draft.planHash);
  if (existing) return existing;
  const result: PurchaseDraft = { ...draft, id: randomUUID(), createdAt: new Date().toISOString(), confirmedAt: null };
  session.drafts.set(result.id, result);
  return result;
}

export function planCacheKey(datasetRevision: string, scenario: AgentScenario) {
  return createHash("sha256").update(`${datasetRevision}:${stable(scenario)}`).digest("hex");
}

export function resetAgentStoreForTests() { sessions.clear(); }
