export type Risk = "critical" | "high" | "watch" | "healthy" | "overstock" | "review";
export type Status = "Заказать срочно" | "Запланировать заказ" | "Заказ не требуется" | "Избыточный запас" | "Требуется проверка" | "Недостаточно данных" | "Нет поставщика";

export interface Sale { date: string; sku: string; productName: string; quantity: number; category: string; promotionFlag?: boolean }
export interface Inventory { sku: string; onHand: number; reserved: number; backorders: number }
export interface Transit { sku: string; quantity: number; eta: string; supplierId: string }
export interface Supplier { supplierId: string; supplierName: string; sku: string; leadTimeDays: number; unitCost: number; minOrderQty: number; packSize: number; reliabilityScore: number }
export interface Product { sku: string; productName: string; category: string; criticality: number }
export interface Outlier { date: string; quantity: number; score: number; reason: string }
export interface Recommendation {
  sku: string; productName: string; category: string; rawHistory: number[]; cleanedHistory: number[]; outliers: Outlier[];
  averageDemand: number; forecastDemand: number; demandStdDev: number; forecastMethod: string; forecastError: number;
  onHand: number; reserved: number; backorders: number; inTransit: number; stockPosition: number;
  inventoryKnown: boolean;
  leadTimeDays: number; safetyStock: number; reorderPoint: number; targetStock: number; rawRecommendedQuantity: number; recommendedQuantity: number;
  packSize: number; minOrderQty: number; daysOfCover: number; estimatedStockoutDate: string | null; stockoutRisk: Risk; overstockRisk: boolean;
  confidenceScore: number; confidenceReasons: string[]; selectedSupplier: Supplier | null; recommendationStatus: Status; warnings: string[];
  estimatedCost: number; naiveForecast: number;
}

export interface Scenario { demandMultiplier: number; delayDays: number; serviceLevel: number; budget: number }
export interface Dataset { sales: Sale[]; inventory: Inventory[]; transit: Transit[]; suppliers: Supplier[]; products: Product[] }
