import * as XLSX from "xlsx";
import type { Dataset, Sale } from "./types";

export type ImportField = "date" | "sku" | "productName" | "quantity";
export type ImportMapping = Record<ImportField, string>;
export interface ImportRow { rowNumber: number; values: Record<string, unknown> }
export interface ImportSource {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: ImportRow[];
  date1904: boolean;
}
export interface ImportRowError { rowNumber: number; messages: string[] }
export interface WeeklyStructureIssue { sku: string; reason: string }
export interface SalesImportValidation {
  sales: Sale[];
  errors: ImportRowError[];
  mappingErrors: string[];
  warnings: string[];
  totalRows: number;
  emptyRows: number;
  rejectedRows: number;
  weeklyIssues: WeeklyStructureIssue[];
  metadata: { kind: "sales-only"; inventoryKnown: false; procurementReady: false };
}

export const IMPORT_FIELDS: { key: ImportField; label: string; required: boolean }[] = [
  { key: "date", label: "Дата продажи", required: true },
  { key: "sku", label: "SKU / артикул", required: true },
  { key: "quantity", label: "Проданное количество", required: true },
  { key: "productName", label: "Название товара", required: false },
];

const aliases: Record<ImportField, string[]> = {
  date: ["date", "дата", "датапродажи", "датапродаж", "week", "неделя"],
  sku: ["sku", "артикул", "код", "кодтовара", "productid"],
  quantity: ["quantity", "qty", "количество", "колво", "продажи", "sales", "проданноеколичество"],
  productName: ["productname", "name", "название", "наименование", "товар", "названиетовара"],
};

const cleanHeader = (header: string) => header.toLocaleLowerCase("ru").replace(/[\s_\-./]/g, "");
const isEmpty = (value: unknown) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");

export function inferImportMapping(headers: string[]): ImportMapping {
  return Object.fromEntries(IMPORT_FIELDS.map(({ key }) => [key, headers.find(header => aliases[key].includes(cleanHeader(header))) ?? ""])) as ImportMapping;
}

function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Only unambiguous calendar formats, actual Date cells, or numeric Excel serials. */
export function parseImportDate(value: unknown, date1904 = false): string | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return calendarDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < (date1904 ? 0 : 1) || (!date1904 && Math.floor(value) === 60)) return null;
    const parts = XLSX.SSF.parse_date_code(value, { date1904 });
    return parts ? calendarDate(parts.y, parts.m, parts.d) : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(text);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const local = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (local) return calendarDate(Number(local[3]), Number(local[2]), Number(local[1]));
  return null;
}

export function parseImportQuantity(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d+(?:[.,]\d+)?$/.test(normalized)) return null;
  const quantity = Number(normalized.replace(",", "."));
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

export function readSalesWorkbook(buffer: ArrayBuffer, fileName: string): ImportSource {
  let csvText: string | undefined;
  if (/\.csv$/i.test(fileName)) {
    try {
      // Decode UTF-8 ourselves: SheetJS interprets an unmarked byte buffer as a legacy codepage.
      csvText = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
    } catch {
      throw new Error("Не удалось прочитать кодировку CSV. Сохраните файл в формате CSV UTF-8 и выберите его снова.");
    }
  }
  const workbook = csvText !== undefined
    ? XLSX.read(csvText, { type: "string", cellDates: false, raw: true })
    : XLSX.read(buffer, { type: "array", cellDates: false, raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("В файле нет листов. Добавьте лист с заголовками и продажами, затем выберите файл снова.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: true });
  if (matrix.length < 2 || !matrix[0]?.some(value => !isEmpty(value))) {
    throw new Error("Не найдены строки продаж под заголовками. Разместите названия колонок в первой строке, а продажи — со второй.");
  }
  if (matrix.length > 100_001) throw new Error("Файл содержит более 100 000 строк. Разделите его на меньшие файлы и выберите один из них.");
  const used = new Set<string>();
  const width = Math.max(...matrix.slice(0, 1000).map(row => row.length));
  const headers = Array.from({ length: width }, (_, index) => {
    const base = String(matrix[0][index] ?? "").trim() || `Колонка ${index + 1}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base} (${suffix++})`;
    used.add(name);
    return name;
  });
  const rows = matrix.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])),
  }));
  return { fileName, sheetName, headers, rows, date1904: Boolean(workbook.Workbook?.WBProps?.date1904) };
}

export function getWeeklyStructureIssues(sales: Sale[]): WeeklyStructureIssue[] {
  const bySku = new Map<string, string[]>();
  for (const sale of sales) {
    const dates = bySku.get(sale.sku);
    if (dates) dates.push(sale.date);
    else bySku.set(sale.sku, [sale.date]);
  }
  return [...bySku].flatMap(([sku, values]) => {
    const dates = [...values].sort();
    if (dates.length < 2) return [{ sku, reason: "Недостаточно наблюдений, чтобы проверить недельный шаг." }];
    if (new Set(dates).size !== dates.length) return [{ sku, reason: "Несколько строк на одну дату. Сначала агрегируйте продажи по товару и неделе." }];
    if (dates.slice(1).some((date, index) => (Date.parse(date) - Date.parse(dates[index])) / 86_400_000 !== 7)) {
      return [{ sku, reason: "Интервалы между наблюдениями не равны 7 дням. Подготовьте непрерывные недельные итоги; неизвестные пропуски не заменяются нулями." }];
    }
    return [];
  });
}

export function validateSalesRows(rows: ImportRow[], mapping: ImportMapping, date1904 = false): SalesImportValidation {
  const result: SalesImportValidation = {
    sales: [], errors: [], mappingErrors: [], warnings: [], totalRows: rows.length, emptyRows: 0, rejectedRows: 0, weeklyIssues: [],
    metadata: { kind: "sales-only", inventoryKnown: false, procurementReady: false },
  };
  for (const field of IMPORT_FIELDS) {
    if (field.required && !mapping[field.key]) result.mappingErrors.push(`Выберите колонку «${field.label}» и повторите проверку.`);
  }
  const mapped = Object.values(mapping).filter(Boolean);
  if (new Set(mapped).size !== mapped.length) result.mappingErrors.push("Одна колонка назначена нескольким полям. Выберите отдельную колонку для каждого поля.");
  if (result.mappingErrors.length) return result;

  let missingNames = 0;
  for (const row of rows) {
    if (Object.values(row.values).every(isEmpty)) { result.emptyRows++; continue; }
    const messages: string[] = [];
    const rawSku = row.values[mapping.sku];
    const sku = typeof rawSku === "string" || (typeof rawSku === "number" && Number.isFinite(rawSku)) ? String(rawSku).trim() : "";
    const date = parseImportDate(row.values[mapping.date], date1904);
    const quantity = parseImportQuantity(row.values[mapping.quantity]);
    if (!sku) messages.push("Не указан SKU: заполните артикул.");
    if (!date) messages.push("Дата некорректна: используйте ГГГГ-ММ-ДД, ДД.ММ.ГГГГ или дату Excel.");
    if (quantity === null) messages.push("Количество отсутствует или некорректно: укажите число от 0; пустая ячейка не считается нулём.");
    if (messages.length) { result.errors.push({ rowNumber: row.rowNumber, messages }); continue; }
    const rawName = mapping.productName ? row.values[mapping.productName] : "";
    const productName = typeof rawName === "string" || typeof rawName === "number" ? String(rawName).trim() : "";
    if (!productName) missingNames++;
    result.sales.push({ sku, date: date!, quantity: quantity!, productName: productName || sku, category: "Импорт" });
  }
  result.rejectedRows = result.errors.length;
  result.weeklyIssues = getWeeklyStructureIssues(result.sales);
  if (missingNames) result.warnings.push(`В ${missingNames} строках нет названия товара: в интерфейсе будет показан SKU.`);
  if (result.emptyRows) result.warnings.push(`Пустые строки пропущены: ${result.emptyRows}. Они не становятся нулевыми продажами.`);
  if (result.weeklyIssues.length) result.warnings.push(`Недельная структура не подтверждена для ${result.weeklyIssues.length} SKU. Историю можно загрузить для просмотра, но недельный прогноз и проверка на истории требуют подготовки данных.`);
  result.warnings.push("Импортируются только продажи. Остатки, резервы, поставки и условия поставщиков неизвестны; закупочные действия будут недоступны.");
  return result;
}

export function datasetFromSales(validation: SalesImportValidation): Dataset {
  if (validation.mappingErrors.length || validation.sales.length === 0) throw new Error("Нет проверенных продаж для импорта. Исправьте сопоставление или строки файла.");
  const products = [...new Map(validation.sales.map(sale => [sale.sku, {
    sku: sale.sku, productName: sale.productName, category: sale.category, criticality: 0,
  }])).values()];
  return { sales: validation.sales.map(sale => ({ ...sale })), products, inventory: [], suppliers: [], transit: [] };
}
