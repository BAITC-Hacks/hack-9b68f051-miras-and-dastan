/**
 * Boundary for the NVIDIA implementation owned by the other developer.
 * This module deliberately does not implement a second reviewer. The host can
 * register the real adapter during server bootstrap when that module lands.
 */
export interface NvidiaReviewInput {
  planId: string;
  planHash: string;
  datasetRevision: string;
  items: Array<{ sku: string; quantity: number; supplierId: string | null; estimatedCost: number }>;
}
export interface NvidiaReviewResult {
  status: "success" | "warning" | "unavailable" | "error";
  reviewId?: string;
  planHash?: string;
  summary?: string;
  warnings?: string[];
  evidenceIds?: string[];
  errorCode?: string;
}
export type NvidiaReviewer = (input: NvidiaReviewInput) => Promise<NvidiaReviewResult>;
let reviewer: NvidiaReviewer | undefined;

export function registerNvidiaReviewer(implementation: NvidiaReviewer | undefined) { reviewer = implementation; }

export async function requestNvidiaReview(input: NvidiaReviewInput): Promise<NvidiaReviewResult> {
  if (!reviewer) return { status: "unavailable", errorCode: "NVIDIA_MODULE_UNAVAILABLE", summary: "Модуль NVIDIA-review ещё не подключён к этому развёртыванию." };
  try {
    const result = await reviewer(input);
    if (result.planHash && result.planHash !== input.planHash) return { status: "error", errorCode: "NVIDIA_PLAN_HASH_MISMATCH", summary: "NVIDIA-review вернул результат для другой версии плана." };
    return result;
  } catch {
    return { status: "error", errorCode: "NVIDIA_REVIEW_FAILED", summary: "NVIDIA-review завершился с ошибкой." };
  }
}
