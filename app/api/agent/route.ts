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
  return `${product}: регулярный прогноз — ${forecast} шт./нед. В доступной позиции ${stock} шт., а точка заказа — ${point} шт. ${outlier ? `Мы отделили ${outlier} нетипичную продажу от регулярного спроса. ` : ""}${recommended ? `Поэтому система предлагает заказать ${recommended} шт.` : "Сейчас заказ не требуется или нужна проверка поставщика."}`;
}

async function explainLegacy(body: LegacyBody, request: Request) {
  const context = body.context ?? {};
  const fallback = localReply(context);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ answer: fallback, mode: "demo" });
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      store: false,
      input: [
        { role: "developer", content: "Ты помощник менеджера закупа. Не рассчитывай и не выдумывай числа. Объясняй только переданный JSON и отвечай кратко, по-русски." },
        { role: "user", content: `Вопрос: ${body.question || "Почему эта рекомендация?"}\nДетерминированные результаты: ${JSON.stringify(context)}` },
      ],
      }),
    });
    if (!response.ok) throw new Error("OpenAI response failed");
    const payload = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const answer = payload.output?.flatMap(message => message.content ?? []).find(content => content.type === "output_text")?.text;
    if (!answer?.trim()) throw new Error('Empty explanation');
    return NextResponse.json({ answer, mode: "ai" });
  } catch {
    return NextResponse.json({ error: 'Сервис объяснений недоступен. Повторите запрос; расчёт остаётся доступен в карточке.' }, { status: 502 });
  }
}


export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON запроса." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Некорректная форма запроса." }, { status: 400 });
  const legacy = body as LegacyBody;
  // The old drawer stays explanation-only and cannot gain plan capabilities
  // from a browser-provided context object.
  if (legacy.context && !(body as { action?: string }).action && !(body as { dataset?: unknown }).dataset) {
    if (typeof legacy.context !== "object" || Array.isArray(legacy.context)) return NextResponse.json({ error: "Некорректный контекст товара." }, { status: 400 });
    return explainLegacy(legacy, request);
  }
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
