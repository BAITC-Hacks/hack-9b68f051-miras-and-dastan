# StockPilot AI

Hackathon-ready веб-продукт для кейса «Автоматический расчёт заказов поставщикам для пополнения склада» компании «Электрокомплект».

Hackathon team repository for Miras and Dastan.

## Что решает

StockPilot AI превращает историю продаж, остатки, товар в пути и условия поставщиков в объяснимые рекомендации по пополнению. Разовые крупные продажи выявляются как выбросы и не раздувают регулярный прогноз.

## Главное

- Детерминированные TypeScript-расчёты: IQR + modified Z-score, взвешенное скользящее среднее, safety stock, reorder point, MOQ и pack size.
- Seeded demo data: 32 SKU, 36 недель истории, поставщики, товары в пути и обязательный кейс `CAB-NYM-3X2.5` с продажей 176 шт.
- Dashboard, фильтры, SKU drawer с графиком raw/cleaned history, what-if сценарии и бюджетный отсев.
- Импорт `.xlsx`, `.xls`, `.csv` с автоматическим mapping основных колонок и предпросмотром.
- Purchase-order draft и безопасный CSV экспорт; значения, опасные для spreadsheet formulas, экранируются.
- Demo Mode работает полностью без API key. Если ключ задан, серверный endpoint использует Responses API только для текстового объяснения переданного детерминированного контекста.

## Архитектура

`React UI → deterministic analytics in lib/analytics → optional /api/agent → OpenAI Responses API`.

LLM не видит исходный Excel и не производит количественные расчёты. API key остаётся на сервере; `store: false` включён.

## Запуск

```bash
npm install
copy .env.example .env.local
npm run dev
```

Проверки:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Переменные окружения

- `OPENAI_API_KEY` — необязательный ключ. При его отсутствии включается Demo Mode.
- `OPENAI_MODEL` — необязательное имя доступной text-модели.
- `NEXT_PUBLIC_DEMO_MODE=true` — маркировка demo environment.

## Формулы и ограничения

- Выбросы: IQR и modified Z-score. Они заменяются средней регулярной продажей в cleaned series.
- Прогноз: weighted moving average по последним 8 неделям.
- Safety stock: `z × σ спроса × √lead time`.
- Reorder point: спрос на lead time + safety stock.
- Рекомендация: target stock − stock position, после чего применяется MOQ и кратность упаковки.

Это MVP принятия решений. В production нужны согласованные уровни сервиса, проверка исходных данных, ассортиментные ограничения и бизнес-валидация формул.

## Demo script (60–90 секунд)

1. Нажмите «Загрузить демо-данные».
2. Откройте `Кабель NYM 3×2.5`.
3. Покажите продажу 176 шт. как исключённую аномалию, raw vs cleaned history и объяснение рекомендации.
4. Вернитесь в таблицу и сдвиньте «Задержка» на +7 дней.
5. Покажите изменение рисков, откройте «Создать заказ» и скачайте CSV-черновик.
