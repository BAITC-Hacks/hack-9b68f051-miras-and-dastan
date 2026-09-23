# Подключение к вашему StockPilot AI

Проверена структура `BAITC-Hacks/hack-9b68f051-miras-and-dastan` на ревизии `46d710c90c9b8d06304e0795b5a960d3cb5d56bb`. Приложение — Next.js 16.3.0; совместимые версии модуля: React/ReactDOM 19.0.0, Recharts 2.15.1, Zod 3.24.1, TypeScript 5.7.2. Существующие файлы основного приложения не меняются. В PR добавляется только папка `stockpilot-backtest/`.

## Независимый запуск

Из папки stockpilot-backtest выполнить `npm install`, затем `npm run dev`. Порт 5187, при занятости Vite выбирает следующий. Для независимой разработки можно вынести папку рядом с основным приложением. Не устанавливать её Vite-зависимости в корень Next.js.

## Реальные данные приложения

`lib/types.ts` определяет `Dataset.sales` с полями `date`, `sku`, `quantity`. Им соответствует `fromStockPilotDataset`. Он фильтрует один SKU, сортирует даты, проверяет непрерывные недели и не читает `inventory` или `transit`.

```ts
import { fromStockPilotDataset, compareStrategies } from './stockpilot-backtest/src/core';

const input = fromStockPilotDataset(dataset, {
  sku: 'CAB-NYM-3X2.5', startIndex: 20, endIndex: 35,
  settings: {
    initialStock: 45, leadTimeDays: 21, reviewPeriod: 1,
    moq: 5, packSize: 5, serviceLevel: '0.95',
  },
  currency: '₸',
});
const results = compareStrategies(input);
```

`initialStock` задаётся как историческое допущение пользователем. Текущее `dataset.inventory[].onHand` не является историческим стартом. По умолчанию стоимости нет. Чтобы явно использовать условия выбранного поставщика, вызовите `getStockPilotSupplierParameters(dataset, sku, supplierId)`: возвращаются leadTimeDays/moq/packSize/unitCost. Это текущее допущение для сценария, а не доказанные исторические условия; применять одинаково к обеим стратегиям. Функция требует единственного соответствующего поставщика и не ранжирует их сама.

Демо основного приложения содержит 36 недель, CAB-всплеск 176 на индексе 32; независимое демо модуля содержит 52 недели и всплеск 180 на индексе 26. Это разные наборы, они не подменяют друг друга.

Импорт основного приложения может содержать отдельные транзакции. Непрерывный недельный ряд нужно подготовить явно до адаптера. Дубли и пропуски отклоняются: адаптер не суммирует произвольные строки и не считает отсутствующие недели нулевыми продажами.

## Подключение настоящего прогноза

Модуль не импортирует внутренние файлы партнёра. Хост передаёт четыре уже существующих функции через dependency injection:

```ts
import { detectOutliers, weightedForecast, stdDev, mean } from './lib/analytics';
import { createStockPilotStrategy, compareStrategies, naiveStrategy } from './stockpilot-backtest/src/core';

const stockPilot = createStockPilotStrategy({ detectOutliers, weightedForecast, stdDev, mean });
const results = compareStrategies(input, [
  { name: 'Обычное среднее', run: naiveStrategy },
  { name: 'StockPilot · основной прогноз', run: stockPilot },
]);
```

Wrapper повторяет очистку `analyzeDataset`: обнаруженные выбросы заменяются округлённым средним меньших прошлых значений, затем выполняются weightedForecast и stdDev. На каждом шаге используются только завершённые прошлые недели. Функции analyzeDataset, текущие Recommendation, рассчитанные по полному ряду outliers, Date.now, бюджет, live inventory и прогнозы на полном датасете не используются.

Метод основного приложения отличается от демонстрационного медианного алгоритма. UI показывает фактически переданные имена. Общая функция пополнения, сроки, MOQ, упаковки, календарь и старт одинаковы. Слабости основного прогноза не исправляются скрыто ради улучшения результата.

## React / Next.js

`src/BacktestPanel.tsx` объявлен Client Component, использует CSS Modules и не зависит от router/store. Публичный UI export — src/index.ts; отдельный src/core.ts безопасен для headless-расчётов без CSS/React/Recharts.

Готовый образец: `examples/StockPilotBacktestBridge.tsx.example`. При ручном подключении скопировать его в components/StockPilotBacktestBridge.tsx основного приложения и передать dataset из существующего app/page.tsx, явные options и revision (версию загруженных данных/начальных настроек). Сам модуль не добавляет маршрут, кнопку меню или глобальный CSS автоматически.

Callbacks и strategy-функции создаются внутри клиентского bridge, их нельзя передавать через границу Server→Client. Данные и настройки сериализуемы. initialInput и inputs читаются при монтировании: при обновлении внешних данных или стратегий менять React key/revision. Массив inputs добавляет внешний каталог SKU; каждый SKU должен встречаться один раз. allowDemo=false скрывает замену входа демонстрационными данными. onResults вызывается после успешного расчёта.

Не импортировать src/main.tsx и standalone.css в Next.js. Все кнопки имеют type=button, поэтому панель не отправляет внешнюю форму.

## Изоляция инструментов

У корня проекта include=`**/*.ts, **/*.tsx`. Поэтому Vite/Vitest-конфигурации модуля имеют расширение .mjs, а CSS — файловую декларацию. Тесты модуля названы `*.checks.ts` и запускаются его vitest.config.mjs, чтобы корневой Vitest 2 не подхватывал автоматически тесты Vitest 4. Node_modules/work/dist не передаются в GitHub. Результаты сборки модуля создаются внутри его node_modules/.cache/stockpilot-backtest/dist, чтобы корневой ESLint не обходил сгенерированный JS.

Это исходниковый модуль, а не опубликованный npm-пакет. Публикация в registry не выполняется. Проверки и ограничения среды записаны в VERIFICATION.md.
