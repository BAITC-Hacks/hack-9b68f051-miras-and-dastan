"use client";

import { useId, useRef, useState } from "react";
import { AlertCircle, Check, ChevronRight, FileSpreadsheet, Upload } from "lucide-react";
import { datasetFromSales, IMPORT_FIELDS, inferImportMapping, readSalesWorkbook, validateSalesRows } from "../lib/import-data";
import type { ImportMapping, ImportSource, SalesImportValidation } from "../lib/import-data";
import type { Dataset } from "../lib/types";
import styles from "./ImportPanel.module.css";

export interface ImportPanelProps {
  onImport: (dataset: Dataset, fileName: string) => void;
  onCancel: () => void;
}

const steps = ["Выбор файла", "Колонки", "Проверка", "Подтверждение"];
const displayCell = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");

export function ImportPanel({ onImport, onCancel }: ImportPanelProps) {
  const id = useId();
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({ date: "", sku: "", productName: "", quantity: "" });
  const [validation, setValidation] = useState<SalesImportValidation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [allowRejectedRows, setAllowRejectedRows] = useState(false);
  const request = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  function goTo(next: number) {
    setStep(next);
    setError("");
    // Focus a stable heading immediately; the next step replaces its text on render.
    heading.current?.focus();
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) { setError("Поддерживаются CSV, XLSX и XLS. Сохраните таблицу в одном из этих форматов и выберите её снова."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Файл больше 10 МБ. Удалите ненужные листы или разделите данные, затем выберите файл снова."); return; }
    const version = ++request.current;
    setError(""); setLoading(true);
    try {
      const next = readSalesWorkbook(await file.arrayBuffer(), file.name);
      if (version !== request.current) return;
      setSource(next); setMapping(inferImportMapping(next.headers)); setValidation(null); setAllowRejectedRows(false); goTo(1);
    } catch (reason) {
      if (version === request.current) setError(`${reason instanceof Error ? reason.message : "Не удалось прочитать файл."} Проверьте формат и первую строку заголовков, затем повторите выбор.`);
    } finally { if (version === request.current) setLoading(false); }
  }

  function validate() {
    if (!source) return;
    setValidation(validateSalesRows(source.rows, mapping, source.date1904));
    setAllowRejectedRows(false); goTo(2);
  }

  function confirm() {
    if (!source || !validation || (validation.rejectedRows > 0 && !allowRejectedRows)) return;
    try { onImport(datasetFromSales(validation), source.fileName); }
    catch (reason) { setError(`${reason instanceof Error ? reason.message : "Не удалось применить импорт."} Вернитесь к проверке и повторите попытку.`); }
  }

  const canContinue = validation && validation.sales.length > 0 && validation.mappingErrors.length === 0;

  return <section className={styles.panel} aria-labelledby={`${id}-title`}>
    <div className={styles.header}>
      <div><h2 id={`${id}-title`} ref={heading} tabIndex={-1}>Импорт продаж</h2><p>Excel или CSV · первый лист · текущие данные изменятся только после подтверждения.</p></div>
      <button type="button" className={styles.secondary} onClick={() => { request.current++; onCancel(); }}>Отменить импорт</button>
    </div>
    <ol className={styles.steps} aria-label="Этапы импорта">{steps.map((name, index) => <li key={name} className={index === step ? styles.activeStep : index < step ? styles.completeStep : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Check size={14} aria-hidden="true" /> : index + 1}</span>{name}</li>)}</ol>
    {error && <div className={`${styles.notice} ${styles.error}`} role="alert"><AlertCircle size={18} aria-hidden="true" /><div>{error}</div></div>}

    {step === 0 && <div className={styles.fileStage}>
      <FileSpreadsheet size={32} aria-hidden="true" />
      <h3>Выберите таблицу продаж</h3>
      <p>Нужны дата, SKU и проданное количество. Название товара — необязательно. Первая строка должна содержать заголовки.</p>
      <label className={styles.fileLabel} htmlFor={`${id}-file`}><Upload size={18} aria-hidden="true" /> Файл Excel / CSV</label>
      <input className={styles.fileInput} id={`${id}-file`} type="file" accept=".csv,.xlsx,.xls" disabled={loading} onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
      <span className={styles.hint}>{loading ? "Чтение файла…" : "До 10 МБ и 100 000 строк. Файл обрабатывается в браузере."}</span>
      <p className={styles.scope}>Этот импорт поддерживает продажи. Он не заполняет остатки и условия поставщиков.</p>
    </div>}

    {source && step === 1 && <>
      <div className={styles.fileMeta}><FileSpreadsheet size={18} aria-hidden="true" /><strong>{source.fileName}</strong><span>Лист: {source.sheetName} · строк до проверки: {source.rows.length}</span></div>
      <h3>Сопоставьте колонки</h3>
      <p className={styles.hint}>Проверьте найденные соответствия. Обязательные поля отмечены звёздочкой.</p>
      <div className={styles.mapping}>{IMPORT_FIELDS.map(field => <label key={field.key} htmlFor={`${id}-${field.key}`}><span>{field.label}{field.required ? " *" : ""}</span><select id={`${id}-${field.key}`} value={mapping[field.key]} onChange={event => setMapping(previous => ({ ...previous, [field.key]: event.target.value }))}><option value="">{field.required ? "Выберите колонку" : "Использовать SKU вместо названия"}</option>{source.headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>
      <div className={styles.tableWrap} tabIndex={0} aria-label="Предпросмотр исходного файла"><table><caption>Первые {Math.min(source.rows.length, 5)} строк файла. Данные ещё не проверены.</caption><thead><tr><th scope="col">Строка</th>{source.headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{source.rows.slice(0, 5).map(row => <tr key={row.rowNumber}><td>{row.rowNumber}</td>{source.headers.map(header => <td key={header} title={displayCell(row.values[header])}>{displayCell(row.values[header]) || "—"}</td>)}</tr>)}</tbody></table></div>
      <div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => goTo(0)}>Другой файл</button><button className={styles.primary} type="button" onClick={validate}>Проверить данные <ChevronRight size={16} aria-hidden="true" /></button></div>
    </>}

    {source && validation && step === 2 && <>
      <div className={styles.fileMeta}><strong>{source.fileName}</strong><span>Проверка завершена</span></div>
      <div className={styles.counts} aria-label="Результаты проверки"><div><span>Строк в файле</span><strong>{validation.totalRows}</strong></div><div><span>Принято после проверки</span><strong>{validation.sales.length}</strong></div><div><span>С ошибками</span><strong>{validation.rejectedRows}</strong></div><div><span>Пустых строк</span><strong>{validation.emptyRows}</strong></div></div>
      {validation.mappingErrors.length > 0 && <div className={`${styles.notice} ${styles.error}`} role="alert"><AlertCircle size={18} aria-hidden="true" /><ul>{validation.mappingErrors.map(message => <li key={message}>{message}</li>)}</ul></div>}
      {validation.errors.length > 0 && <div className={styles.validationErrors}><h3>Ошибки строк</h3><p>Исправьте файл и загрузите его снова или на следующем шаге явно подтвердите исключение этих строк.</p><div className={styles.errorList}><ul>{validation.errors.slice(0, 30).map(row => <li key={row.rowNumber}><strong>Строка {row.rowNumber}.</strong> {row.messages.join(" ")}</li>)}</ul></div>{validation.errors.length > 30 && <p>Показаны первые 30 ошибочных строк из {validation.errors.length}.</p>}</div>}
      {validation.warnings.length > 0 && <div className={`${styles.notice} ${styles.warning}`}><AlertCircle size={18} aria-hidden="true" /><div><strong>Ограничения импорта</strong><ul>{validation.warnings.map(message => <li key={message}>{message}</li>)}</ul></div></div>}
      {validation.weeklyIssues.length > 0 && <details className={styles.details}><summary>Проблемы недельной структуры · {validation.weeklyIssues.length} SKU</summary><ul>{validation.weeklyIssues.slice(0, 30).map(issue => <li key={issue.sku}><strong>{issue.sku}:</strong> {issue.reason}</li>)}</ul>{validation.weeklyIssues.length > 30 && <p>Показаны первые 30 SKU.</p>}</details>}
      {!validation.sales.length && !validation.mappingErrors.length && <p className={styles.noRows}>Нет проверенных продаж для загрузки. Исправьте указанные ошибки или выберите другой файл.</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => goTo(1)}>Изменить колонки</button><button type="button" className={styles.primary} disabled={!canContinue} onClick={() => goTo(3)}>К подтверждению <ChevronRight size={16} aria-hidden="true" /></button></div>
    </>}

    {source && validation && step === 3 && <>
      <h3>Подтвердите загрузку продаж</h3>
      <dl className={styles.summary}><div><dt>Файл</dt><dd>{source.fileName}</dd></div><div><dt>Проверенных строк</dt><dd>{validation.sales.length}</dd></div><div><dt>Товаров</dt><dd>{new Set(validation.sales.map(sale => sale.sku)).size}</dd></div><div><dt>Область данных</dt><dd>Только продажи</dd></div></dl>
      <div className={`${styles.notice} ${styles.warning}`}><AlertCircle size={18} aria-hidden="true" /><p>Текущий рабочий набор будет заменён проверенными продажами. Остатки и поставщики не импортированы. Создание закупочных черновиков будет недоступно. Данные не сохраняются после перезагрузки страницы.</p></div>
      {validation.rejectedRows > 0 && <label className={styles.confirmCheck}><input type="checkbox" checked={allowRejectedRows} onChange={event => setAllowRejectedRows(event.target.checked)} /><span>Импортировать {validation.sales.length} проверенных строк и исключить {validation.rejectedRows} строк с ошибками. Я понимаю, что история будет неполной.</span></label>}
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => goTo(2)}>Назад к проверке</button><button type="button" className={styles.primary} disabled={validation.rejectedRows > 0 && !allowRejectedRows} onClick={confirm}>Импортировать продажи</button></div>
    </>}
  </section>;
}
