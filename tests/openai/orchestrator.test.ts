import { describe, expect, it } from "vitest";
import { makeDemoData } from "../../lib/demo-data";
import { runAgent, type ResponseClient } from "../../lib/openai/orchestrator";
import { createSession, updateSessionDataset } from "../../lib/openai/session/store";

const createReadySession = () => { const session = createSession("test-owner", 60); updateSessionDataset(session, makeDemoData()); return session; };

describe("agent orchestration", () => {
  it("continues a Responses function-call loop and emits a truthful action log", async () => {
    const session = createReadySession(); const events: string[] = []; let calls = 0;
    const client: ResponseClient = async () => {
      calls += 1;
      return calls === 1 ? { output: [{ type: "function_call", call_id: "call_1", name: "get_dataset_summary", arguments: "{}" }] } : { output_text: "Готово." };
    };
    const result = await runAgent({ session, question: "Что требует внимания?", config: { apiKey: "test", model: "test", maxIterations: 4, maxToolCalls: 4, timeoutMs: 1_000, sessionTtlMinutes: 60 }, responseClient: client, onEvent: event => events.push(event.type) });
    expect(calls).toBe(2); expect(result.mode).toBe("openai"); expect(result.answer).toBe("Готово."); expect(events).toContain("tool_started"); expect(events).toContain("tool_finished");
  });

  it("stops an incomplete tool loop at the configured iteration limit", async () => {
    const session = createReadySession(); const client: ResponseClient = async () => ({ output: [{ type: "function_call", call_id: crypto.randomUUID(), name: "get_dataset_summary", arguments: "{}" }] });
    const result = await runAgent({ session, question: "Сводка", config: { apiKey: "test", model: "test", maxIterations: 1, maxToolCalls: 4, timeoutMs: 1_000, sessionTtlMinutes: 60 }, responseClient: client });
    expect(result.answer).toContain("не завершил");
  });

  it("replaces an ungrounded numeric model claim with the deterministic tool result", async () => {
    const session = createReadySession(); let calls = 0;
    const client: ResponseClient = async () => { calls += 1; return calls === 1 ? { output: [{ type: "function_call", call_id: "call_summary", name: "get_dataset_summary", arguments: "{}" }] } : { output_text: "There are 4 critical products." }; };
    const result = await runAgent({ session, question: "Что требует внимания?", config: { apiKey: "test", model: "test", maxIterations: 3, maxToolCalls: 3, timeoutMs: 1_000, sessionTtlMinutes: 60 }, responseClient: client });
    expect(result.answer).toContain("Критический риск есть у 4 SKU");
  });

  it("falls back locally when no OpenAI configuration exists", async () => {
    const session = createReadySession(); const result = await runAgent({ session, question: "Сделай закупку", config: { maxIterations: 4, maxToolCalls: 4, timeoutMs: 1_000, sessionTtlMinutes: 60 } });
    expect(result.mode).toBe("local"); expect(result.activePlanId).toBeDefined();
  });
});
