import { cookies } from "next/headers";
import { AgentRunRequestSchema } from "../../../../lib/openai/contracts";
import { runAgent } from "../../../../lib/openai/orchestrator";
import { getOwnedSession, updateSessionDataset } from "../../../../lib/openai/session/store";

export const dynamic = "force-dynamic";
const OWNER_COOKIE = "stockpilot_agent_owner";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Некорректный JSON запроса." }, { status: 400 }); }
  const parsed = AgentRunRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.action !== "run" || !parsed.data.sessionId || !parsed.data.question) return Response.json({ error: "Для stream-запуска нужны сессия и вопрос." }, { status: 400 });
  const ownerId = (await cookies()).get(OWNER_COOKIE)?.value; const session = ownerId ? getOwnedSession(parsed.data.sessionId, ownerId) : undefined;
  if (!session) return Response.json({ error: "Сессия агента не найдена или недоступна." }, { status: 403 });
  if (parsed.data.dataset) updateSessionDataset(session, parsed.data.dataset);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await runAgent({ session, question: parsed.data.question!, selectedSku: parsed.data.selectedSku, activePlanId: parsed.data.activePlanId, signal: request.signal, onEvent: event => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)) });
      } catch {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", status: "error", message: "Не удалось завершить поток агента." })}\n`));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
