import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAgentConfig } from "../../../lib/openai/config";
import { AgentRunRequestSchema } from "../../../lib/openai/contracts";
import { runAgent } from "../../../lib/openai/orchestrator";
import { createSession, deleteOwnedSession, getOwnedSession, updateSessionDataset } from "../../../lib/openai/session/store";

export const dynamic = "force-dynamic";
const OWNER_COOKIE = "stockpilot_agent_owner";
type LegacyBody = { question?: string; context?: Record<string, unknown> };

function localReply(context: Record<string, unknown>) {
  const product = String(context.productName ?? "этого SKU");
  const recommended = Number(context.recommendedQuantity ?? 0);
  const forecast = Number(context.forecastDemand ?? 0).toFixed(1);
  const stock = Number(context.stockPosition ?? 0);
  const point = Number(context.reorderPoint ?? 0);
  const outlier = Number(context.outliers ?? 0);
  return `${product}: переданный браузером контекст не является серверным расчётом. Для проверяемого результата откройте панель агента. Локальное пояснение: прогноз ${forecast} шт./нед., позиция ${stock} шт., точка заказа ${point} шт.${outlier ? ` Учтено аномалий: ${outlier}.` : ""}${recommended ? ` В показанном контексте рекомендация — ${recommended} шт.` : ""}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON запроса." }, { status: 400 }); }
  const legacy = body as LegacyBody;
  // The old drawer stays explanation-only and cannot gain plan capabilities
  // from a browser-provided context object.
  if (legacy.context && !(body as { action?: string }).action && !(body as { dataset?: unknown }).dataset) return NextResponse.json({ answer: localReply(legacy.context), mode: "demo", warning: "Legacy context is unverified." });
  const parsed = AgentRunRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Проверьте форму запроса агента." }, { status: 400 });
  const input = parsed.data; const cookieStore = await cookies(); const existingOwner = cookieStore.get(OWNER_COOKIE)?.value; const ownerId = existingOwner ?? randomUUID(); const config = getAgentConfig();
  if (input.action === "initialize") {
    if (!input.dataset) return NextResponse.json({ error: "Для новой сессии нужен нормализованный dataset." }, { status: 400 });
    const session = createSession(ownerId, config.sessionTtlMinutes); const datasetRevision = updateSessionDataset(session, input.dataset);
    const response = NextResponse.json({ sessionId: session.id, datasetRevision, asOfDate: session.asOfDate, capabilities: { canForecast: true, canCalculateReplenishment: true, canSimulateCurrentPlan: true, canRunForecastBacktest: true, canRunPortfolioBacktest: false, canCompareSuppliers: true, canReviewWithNvidia: true, canCreateDraft: true, canExport: true } });
    response.cookies.set(OWNER_COOKIE, ownerId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: config.sessionTtlMinutes * 60, path: "/" });
    return response;
  }
  if (!input.sessionId) return NextResponse.json({ error: "Сначала инициализируйте сессию агента." }, { status: 400 });
  const session = existingOwner ? getOwnedSession(input.sessionId, existingOwner) : undefined;
  if (!session) return NextResponse.json({ error: "Сессия агента не найдена или недоступна." }, { status: 403 });
  if (input.action === "clear") return NextResponse.json({ cleared: deleteOwnedSession(input.sessionId, existingOwner!) });
  if (input.dataset) updateSessionDataset(session, input.dataset);
  if (!input.question) return NextResponse.json({ error: "Введите вопрос для агента." }, { status: 400 });
  const result = await runAgent({ session, question: input.question, selectedSku: input.selectedSku, activePlanId: input.activePlanId, signal: request.signal });
  return NextResponse.json(result);
}
