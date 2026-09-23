import { NextResponse } from "next/server";

type AgentBody = { question?: string; context?: Record<string, unknown> };

function localReply(context: Record<string, unknown>) {
  const product = String(context.productName ?? "этого SKU");
  const recommended = Number(context.recommendedQuantity ?? 0);
  const forecast = Number(context.forecastDemand ?? 0).toFixed(1);
  const stock = Number(context.stockPosition ?? 0);
  const point = Number(context.reorderPoint ?? 0);
  const outlier = Number(context.outliers ?? 0);
  return `${product}: регулярный прогноз — ${forecast} шт./нед. В доступной позиции ${stock} шт., а точка заказа — ${point} шт. ${outlier ? `Мы отделили ${outlier} нетипичную продажу от регулярного спроса. ` : ""}${recommended ? `Поэтому система предлагает заказать ${recommended} шт.` : "Сейчас заказ не требуется или нужна проверка поставщика."}`;
}

export async function POST(request: Request) {
  let body: AgentBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Некорректный запрос. Повторите объяснение из карточки товара.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || !body.context || typeof body.context !== 'object' || Array.isArray(body.context)) {
    return NextResponse.json({ error: 'Не переданы результаты расчёта. Откройте карточку товара заново.' }, { status: 400 });
  }
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
