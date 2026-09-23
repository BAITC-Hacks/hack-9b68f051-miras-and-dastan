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
- StockPilot Procurement Agent: изолированная серверная сессия, versioned dataset/plan, function-calling через Responses API, потоковый журнал действий, безопасный local fallback и подтверждаемые черновики заказов.
- Demo Mode работает полностью без API key. Если ключ и модель настроены, Responses API выбирает только ограниченный набор функций; исходный Excel и секреты в модель не передаются.

## Архитектура

`React UI → normalised dataset → /api/agent session → deterministic tool registry → optional OpenAI Responses API`.

LLM не видит исходный Excel и не производит количественные расчёты. API key остаётся на сервере; `store: false` включён. Подробности инструментария, сессий, NVIDIA boundary и demo-сценария — в [документации интеграции](docs/OPENAI_INTEGRATION.md).

## Запуск

```bash
pnpm install --frozen-lockfile
copy .env.example .env.local
pnpm run dev
```

Проверки:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

## Переменные окружения

- `OPENAI_API_KEY` — необязательный ключ. При его отсутствии включается Demo Mode.
- `OPENAI_MODEL` — имя модели, фактически доступной этому ключу. Без неё OpenAI намеренно не вызывается.
- `AGENT_MAX_ITERATIONS`, `AGENT_MAX_TOOL_CALLS`, `AGENT_RUN_TIMEOUT_MS`, `AGENT_SESSION_TTL_MINUTES` — серверные limits agent-run.
- `NEXT_PUBLIC_DEMO_MODE=true` — маркировка demo environment.

## Формулы и ограничения

- Выбросы: IQR и modified Z-score. Они заменяются средней регулярной продажей в cleaned series.
- Прогноз: weighted moving average по последним 8 неделям.
- Safety stock: `z × σ спроса × √lead time`.
- Reorder point: спрос на lead time + safety stock.
- Рекомендация: target stock − stock position, после чего применяется MOQ и кратность упаковки.

Это MVP принятия решений. В production нужны согласованные уровни сервиса, проверка исходных данных, ассортиментные ограничения и бизнес-валидация формул.

## Demo script (90–120 секунд)

1. Нажмите «Загрузить демо-данные».
2. В панели **StockPilot Procurement Agent** нажмите «Что требует внимания?» и покажите журнал действий.
3. Откройте `Кабель NYM 3×2.5`, покажите продажу 176 шт. как исключённую аномалию и запросите объяснение SKU.
4. Напишите «Подготовь закупочный план в пределах текущего бюджета».
5. Запустите «Проверить задержку» и покажите отдельную версию расчёта.
6. Запустите NVIDIA-review: если модуль друга ещё не подключён, панель честно покажет `unavailable`.
7. Подготовьте черновик: он не отправляет заказ и явно требует подтверждения перед экспортом.
