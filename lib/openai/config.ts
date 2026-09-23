export interface AgentConfig {
  apiKey?: string;
  model?: string;
  maxIterations: number;
  maxToolCalls: number;
  timeoutMs: number;
  sessionTtlMinutes: number;
}

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function getAgentConfig(): AgentConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    model: process.env.OPENAI_MODEL?.trim() || undefined,
    maxIterations: positiveInteger(process.env.AGENT_MAX_ITERATIONS, 8),
    maxToolCalls: positiveInteger(process.env.AGENT_MAX_TOOL_CALLS, 20),
    timeoutMs: positiveInteger(process.env.AGENT_RUN_TIMEOUT_MS, 120_000),
    sessionTtlMinutes: positiveInteger(process.env.AGENT_SESSION_TTL_MINUTES, 60),
  };
}
