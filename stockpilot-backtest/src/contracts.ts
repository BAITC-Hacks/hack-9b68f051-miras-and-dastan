import { z } from 'zod';
const n = z.number().finite().nonnegative();
const integer = n.int();
export const HistoricalObservationSchema = z.object({ sku: z.string().min(1), date: z.string().date(), demand: n });
export type HistoricalObservation = z.infer<typeof HistoricalObservationSchema>;
export const SettingsSchema = z.object({ initialStock: n, leadTimeDays: integer.max(3650), reviewPeriod: integer.min(1).max(520), moq: integer, packSize: integer.min(1), serviceLevel: z.enum(['0.5','0.9','0.95','0.99']) });
export const OrderSchema = z.object({ placedAt: integer, arrivesAt: integer, quantity: n });
export const BacktestInputSchema = z.object({ sku: z.string().min(1), observations: z.array(HistoricalObservationSchema).min(1), startIndex: integer, endIndex: integer, settings: SettingsSchema, unitCost: n.optional(), currency: z.string().default('₸'), source: z.enum(['sales','demand']).default('sales') }).superRefine((v, ctx) => {
  if (v.endIndex < v.startIndex || v.endIndex >= v.observations.length) ctx.addIssue({ code:'custom', message:'Некорректный период проверки' });
  v.observations.forEach((o,i) => {
    if(o.sku !== v.sku) ctx.addIssue({ code:'custom',message:'Вход должен содержать один SKU' });
    if(i > 0 && Date.parse(o.date)-Date.parse(v.observations[i-1]!.date) !== 604800000) ctx.addIssue({code:'custom',message:'Требуется непрерывный недельный ряд без дублей; пропуски нельзя автоматически считать нулями'});
  });
});
export type BacktestInput = z.infer<typeof BacktestInputSchema>;
export const StrategyContextSchema = z.object({ history:z.array(HistoricalObservationSchema), currentStock:n, openOrders:z.array(OrderSchema), settings:SettingsSchema });
export type StrategyContext = z.infer<typeof StrategyContextSchema>;
export const StrategyDecisionSchema = z.object({ forecast:n, deviation:n, adjustedCount:integer, method:z.string() });
export type StrategyDecision = z.infer<typeof StrategyDecisionSchema>;
export type Strategy = (context: StrategyContext) => StrategyDecision;
export const SimulationStepSchema = z.object({ index:integer, date:z.string().date(), demand:n, openingStock:n, receipts:n, served:n, unmet:n, endingStock:n, peakStock:n, ordered:n, inTransit:n, decision:StrategyDecisionSchema.optional(), order:OrderSchema.optional() });
export type SimulationStep = z.infer<typeof SimulationStepSchema>;
export const BacktestMetricsSchema = z.object({ servedDemand:n, unmetDemand:n, fillRate:n.max(1), shortagePeriods:integer, averageEndingStock:n, maxStock:n, orderCount:integer, orderedQuantity:n, endingStock:n, inTransit:n, purchaseCost:n.optional(), averageInventoryCost:n.optional() });
export type BacktestMetrics = z.infer<typeof BacktestMetricsSchema>;
export const BacktestResultSchema = z.object({ strategy:z.string(), sku:z.string(), leadTimeWeeks:integer, steps:z.array(SimulationStepSchema), metrics:BacktestMetricsSchema, openOrders:z.array(OrderSchema), currency:z.string() });
export type BacktestResult = z.infer<typeof BacktestResultSchema>;
