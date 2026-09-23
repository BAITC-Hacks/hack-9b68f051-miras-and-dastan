import { describe, expect, it } from "vitest";
import { makeDemoData } from "../../lib/demo-data";
import { createSession, getOwnedSession, updateSessionDataset } from "../../lib/openai/session/store";
import { executeTool } from "../../lib/openai/tool-registry";

const sessionWithDemo = () => { const session = createSession("owner-a", 60); updateSessionDataset(session, makeDemoData()); return session; };

describe("StockPilot agent tools", () => {
  it("uses the real deterministic plan and keeps MOQ/pack rules", async () => {
    const session = sessionWithDemo(); const result = await executeTool("calculate_purchase_plan", { budget: 1_500_000, demandMultiplier: 1, delayDays: 0, serviceLevel: .95 }, session);
    expect(result.status).not.toBe("error"); const plan = session.plans.get((result.data as { planId: string }).planId)!;
    for (const item of plan.items.filter(item => item.recommendedQuantity > 0 && item.selectedSupplier)) {
      expect(item.recommendedQuantity).toBeGreaterThanOrEqual(item.minOrderQty);
      expect(item.recommendedQuantity % item.packSize).toBe(0);
    }
    expect(plan.items.reduce((sum, item) => sum + item.estimatedCost, 0)).toBeLessThanOrEqual(1_500_000);
  });

  it("includes the three most urgent deterministic products in dataset summary", async () => {
    const session = sessionWithDemo(); const result = await executeTool("get_dataset_summary", {}, session);
    const data = result.data as { criticalRiskCount: number; urgentProducts: Array<{ sku: string }> };
    expect(data.criticalRiskCount).toBe(4); expect(data.urgentProducts).toHaveLength(3); expect(data.urgentProducts[0]?.sku).toBeTruthy();
  });

  it("treats zero budget as zero rather than unlimited", async () => {
    const session = sessionWithDemo(); const result = await executeTool("calculate_purchase_plan", { budget: 0, demandMultiplier: 1, delayDays: 0, serviceLevel: .95 }, session);
    const plan = session.plans.get((result.data as { planId: string }).planId)!;
    expect(plan.items.reduce((sum, item) => sum + item.estimatedCost, 0)).toBe(0);
    expect(plan.items.some(item => item.warnings.some(warning => warning.includes("бюджет")))).toBe(true);
  });

  it("does not allow another owner to read a session plan", async () => {
    const session = sessionWithDemo(); const result = await executeTool("calculate_purchase_plan", { budget: 1_500_000, demandMultiplier: 1, delayDays: 0, serviceLevel: .95 }, session);
    expect(getOwnedSession(session.id, "owner-b")).toBeUndefined();
    const unrelated = createSession("owner-b", 60); updateSessionDataset(unrelated, makeDemoData());
    const denied = await executeTool("analyze_budget_coverage", { planId: (result.data as { planId: string }).planId }, unrelated);
    expect(denied.errorCode).toBe("PLAN_NOT_FOUND");
  });

  it("rejects a stale plan after a dataset revision changes", async () => {
    const session = sessionWithDemo(); const result = await executeTool("calculate_purchase_plan", { budget: 1_500_000, demandMultiplier: 1, delayDays: 0, serviceLevel: .95 }, session);
    const changed = structuredClone(makeDemoData()); changed.sales[0]!.quantity += 1; updateSessionDataset(session, changed);
    const stale = await executeTool("analyze_budget_coverage", { planId: (result.data as { planId: string }).planId }, session);
    expect(stale.errorCode).toBe("PLAN_STALE");
  });

  it("returns one idempotent draft for repeated calls", async () => {
    const session = sessionWithDemo(); const plan = await executeTool("calculate_purchase_plan", { budget: 1_500_000, demandMultiplier: 1, delayDays: 0, serviceLevel: .95 }, session); const planId = (plan.data as { planId: string }).planId;
    const first = await executeTool("draft_purchase_order", { planId }, session); const second = await executeTool("draft_purchase_order", { planId }, session);
    expect((first.data as { draftId: string }).draftId).toBe((second.data as { draftId: string }).draftId);
  });

  it("returns a safe envelope for unknown tools and invalid arguments", async () => {
    const session = sessionWithDemo();
    await expect(executeTool("not_allowed", {}, session)).resolves.toMatchObject({ status: "error", errorCode: "UNKNOWN_TOOL" });
    await expect(executeTool("get_sku_details", { sku: 42, planId: null }, session)).resolves.toMatchObject({ status: "error", errorCode: "INVALID_TOOL_ARGUMENTS" });
  });
});
