import type { Dataset, Product, Sale, Supplier } from "./types";

const products: Product[] = [
  ["CAB-NYM-3X2.5", "Кабель NYM 3×2.5", "Кабель", 5], ["BRK-16A", "Автоматический выключатель 16A", "Автоматика", 4], ["OUT-DOUBLE", "Розетка двойная", "Электроустановка", 4], ["LED-36W", "Светильник LED 36W", "Освещение", 3], ["RCD-40A", "УЗО 40A", "Автоматика", 5], ["BOX-100", "Распределительная коробка", "Монтаж", 2], ["TERM-12", "Клемма 12-полюсная", "Монтаж", 2], ["CORR-20", "Гофротруба 20 мм", "Кабельные системы", 3], ["DUCT-40", "Кабель-канал 40×25", "Кабельные системы", 3], ["CONT-25", "Контактор 25A", "Автоматика", 4], ["SW-1", "Выключатель одноклавишный", "Электроустановка", 3], ["LAM-9W", "Лампа LED 9W", "Освещение", 2], ["CAB-VVG-3X1.5", "Кабель ВВГнг 3×1.5", "Кабель", 4], ["TAPE-20", "Изолента ПВХ", "Монтаж", 1], ["FUSE-10", "Предохранитель 10A", "Автоматика", 3], ["SENSOR-PIR", "Датчик движения PIR", "Автоматика", 2], ["PANEL-12", "Щит распределительный 12 модулей", "Щиты", 4], ["SOCKET-IP44", "Розетка IP44", "Электроустановка", 3], ["CLAMP-20", "Хомут 20 мм", "Монтаж", 1], ["RELAY-220", "Реле напряжения", "Автоматика", 4], ["CAB-FIRE", "Огнестойкий кабель FRLS", "Кабель", 5], ["TUBE-16", "Термоусадочная трубка", "Монтаж", 1], ["LAMP-IND", "Светильник промышленный", "Освещение", 3], ["BUS-PE", "Шина PE", "Щиты", 3], ["METER-1P", "Счётчик однофазный", "Учёт", 4], ["TIE-200", "Стяжка кабельная 200 мм", "Монтаж", 1], ["CONN-WAGO", "Соединитель WAGO", "Монтаж", 3], ["CABLE-UTP", "Кабель UTP Cat.6", "Кабель", 3], ["LED-STRIP", "Лента LED 5 м", "Освещение", 2], ["GLOBE-60", "Лампа накаливания 60W", "Освещение", 1], ["SOCKET-FLOOR", "Розетка напольная", "Электроустановка", 2], ["SURGE-3P", "Ограничитель перенапряжения", "Автоматика", 4]].map(([sku, productName, category, criticality]) => ({ sku: String(sku), productName: String(productName), category: String(category), criticality: Number(criticality) }));

const isoWeek = (week: number) => new Date(Date.UTC(2025, 2, 3 + week * 7)).toISOString().slice(0, 10);
export function makeDemoData(): Dataset {
  const sales: Sale[] = products.flatMap((product, p) => Array.from({ length: p === 30 ? 8 : 36 }, (_, week) => {
    const trend = p % 5 === 0 ? week * .11 : p % 5 === 1 ? -week * .04 : 0;
    const seasonal = p % 7 === 0 ? Math.sin(week / 4) * 3 : 0;
    let quantity = Math.max(1, Math.round(6 + (p % 8) + trend + seasonal + ((week * 3 + p * 7) % 5 - 2)));
    if (product.sku === "CAB-NYM-3X2.5" && week === 32) quantity = 176;
    if (product.sku === "LED-36W" && week === 17) quantity = 95;
    if (product.sku === "GLOBE-60") quantity = Math.max(1, Math.round(20 - week * .4));
    return { date: isoWeek(week), sku: product.sku, productName: product.productName, quantity, category: product.category, promotionFlag: product.sku === "LED-36W" && week === 17 };
  }));
  const suppliers: Supplier[] = products.flatMap((product, p) => p === 31 ? [] : [
    { supplierId: p % 3 === 0 ? "ET" : "LUX", supplierName: p % 3 === 0 ? "ElectroTrade" : "LuxSupply", sku: product.sku, leadTimeDays: 12 + (p % 4) * 5, unitCost: 650 + p * 105, minOrderQty: p % 4 === 0 ? 20 : 5, packSize: p % 3 === 0 ? 10 : 5, reliabilityScore: p === 9 ? 58 : 81 + (p % 13) },
    { supplierId: "KZ-ELECTRO", supplierName: "KZ Electro", sku: product.sku, leadTimeDays: 18 + (p % 5) * 3, unitCost: 700 + p * 100, minOrderQty: 10, packSize: 5, reliabilityScore: 78 }
  ]);
  const inventory = products.map((product, p) => ({ sku: product.sku, onHand: product.sku === "CAB-NYM-3X2.5" ? 17 : p % 6 === 0 ? 230 : 12 + (p * 17) % 80, reserved: p % 5, backorders: p % 11 === 0 ? 4 : 0 }));
  const transit = products.filter((_, p) => p % 4 === 0).map((product, p) => ({ sku: product.sku, quantity: product.sku === "CAB-NYM-3X2.5" ? 10 : 10 + p * 3, eta: new Date(Date.now() + (8 + p) * 86_400_000).toISOString().slice(0, 10), supplierId: p % 3 === 0 ? "ET" : "LUX" }));
  return { sales, inventory, transit, suppliers, products };
}
