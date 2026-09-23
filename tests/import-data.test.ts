import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { datasetFromSales, getWeeklyStructureIssues, inferImportMapping, parseImportDate, parseImportQuantity, readSalesWorkbook, validateSalesRows } from "../lib/import-data";
import type { ImportMapping, ImportRow } from "../lib/import-data";

const mapping: ImportMapping = { date: "Дата", sku: "SKU", productName: "Товар", quantity: "Количество" };
const row = (values: Record<string, unknown>, rowNumber = 2): ImportRow => ({ rowNumber, values });

describe("validated sales-only import", () => {
  it("accepts real calendar dates, Date cells and both Excel date systems", () => {
    expect(parseImportDate("2024-02-29")).toBe("2024-02-29");
    expect(parseImportDate("29.02.2024")).toBe("2024-02-29");
    expect(parseImportDate(new Date("2026-09-23T00:00:00Z"))).toBe("2026-09-23");
    expect(parseImportDate(61)).toBe("1900-03-01");
    expect(parseImportDate(0, true)).toBe("1904-01-01");
  });

  it("rejects impossible or ambiguous dates without normalizing them into valid dates", () => {
    for (const invalid of ["2025-02-29", "31.04.2026", "09/10/2026", "not a date", "", "46000", 0, -1, 60, Number.NaN, new Date("invalid")]) {
      expect(parseImportDate(invalid)).toBeNull();
    }
  });

  it("distinguishes missing quantities from an explicit zero", () => {
    expect(parseImportQuantity(0)).toBe(0);
    expect(parseImportQuantity("0")).toBe(0);
    expect(parseImportQuantity("1 234,5")).toBe(1234.5);
    for (const invalid of [undefined, null, "", "  ", true, -1, "NaN", "12kg", Infinity]) expect(parseImportQuantity(invalid)).toBeNull();
  });

  it("counts actually accepted rows and rejects missing or malformed fields", () => {
    const result = validateSalesRows([
      row({ Дата: "2026-09-01", SKU: "A", Количество: "0" }, 2),
      row({ Дата: "2026-09-08", SKU: "A", Количество: "" }, 3),
      row({ Дата: "2026-02-30", SKU: "A", Количество: 4 }, 4),
      row({ Дата: "2026-09-08", SKU: "", Количество: 4 }, 5),
      row({ Дата: "", SKU: "", Количество: "" }, 6),
    ], mapping);
    expect(result.totalRows).toBe(5);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].quantity).toBe(0);
    expect(result.rejectedRows).toBe(3);
    expect(result.emptyRows).toBe(1);
    expect(result.errors.map(error => error.rowNumber)).toEqual([3, 4, 5]);
  });

  it("does not validate unassigned or multiply assigned columns", () => {
    const result = validateSalesRows([row({ SKU: "A" })], { ...mapping, date: "", quantity: "SKU" });
    expect(result.mappingErrors).toHaveLength(2);
    expect(result.sales).toHaveLength(0);
    expect(() => datasetFromSales(result)).toThrow();
  });

  it("keeps gaps and duplicates explicit instead of filling unknown sales with zero", () => {
    const result = validateSalesRows([
      row({ Дата: "2026-09-01", SKU: "A", Количество: 5 }),
      row({ Дата: "2026-09-15", SKU: "A", Количество: 6 }, 3),
    ], mapping);
    expect(result.weeklyIssues).toHaveLength(1);
    expect(result.sales.map(sale => sale.date)).toEqual(["2026-09-01", "2026-09-15"]);
    expect(getWeeklyStructureIssues([...result.sales, result.sales[0]])[0].reason).toContain("Несколько строк");
  });

  it("imports a sales-only dataset without invented stock or suppliers", () => {
    const validation = validateSalesRows([
      row({ Дата: "2026-09-01", SKU: "A", Количество: 5 }),
      row({ Дата: "2026-09-08", SKU: "A", Количество: 6 }, 3),
    ], mapping);
    const dataset = datasetFromSales(validation);
    expect(validation.weeklyIssues).toEqual([]);
    expect(validation.metadata).toEqual({ kind: "sales-only", inventoryKnown: false, procurementReady: false });
    expect(dataset.inventory).toEqual([]);
    expect(dataset.suppliers).toEqual([]);
    expect(dataset.transit).toEqual([]);
    expect(dataset.products).toHaveLength(1);
    expect(dataset.products[0].productName).toBe("A");
    dataset.sales[0].quantity = 999;
    expect(validation.sales[0].quantity).toBe(5);
  });

  it("reads actual Excel cells and infers Russian headers", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Дата", "Артикул", "Кол-во"], [61, "A", 0], ["", "A", ""]]), "Продажи");
    const source = readSalesWorkbook(XLSX.write(workbook, { type: "array", bookType: "xlsx" }), "sales.xlsx");
    const inferred = inferImportMapping(source.headers);
    expect(inferred).toMatchObject({ date: "Дата", sku: "Артикул", quantity: "Кол-во" });
    const result = validateSalesRows(source.rows, inferred, source.date1904);
    expect(result.sales[0]).toMatchObject({ date: "1900-03-01", sku: "A", quantity: 0 });
    expect(result.rejectedRows).toBe(1);
  });

  it.each(["", "\uFEFF"])("preserves UTF-8 Cyrillic CSV headers and values with BOM %j", bom => {
    const bytes = new TextEncoder().encode(`${bom}Дата,Артикул,Название,Количество\r\n2026-09-01,TEST-CABLE,Тестовый кабель,10\r\n2026-09-08,TEST-CABLE,Тестовый кабель,12`);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const source = readSalesWorkbook(buffer, "sales.csv");
    const result = validateSalesRows(source.rows, inferImportMapping(source.headers), source.date1904);
    expect(source.headers).toEqual(["Дата", "Артикул", "Название", "Количество"]);
    expect(result.sales).toHaveLength(2);
    expect(result.sales[0].productName).toBe("Тестовый кабель");
    expect(result.rejectedRows).toBe(0);
  });

  it("rejects non-UTF-8 CSV with an actionable encoding error", () => {
    expect(() => readSalesWorkbook(new Uint8Array([0xc2, 0x20]).buffer, "sales.csv")).toThrow("CSV UTF-8");
  });
});
