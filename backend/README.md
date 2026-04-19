# Zakaz backend

Готовая серверная часть для мобильного заказа.

## Что внутри
- Express API
- PostgreSQL через Prisma
- Парсер заказа из текста
- Суммирование дублей
- Приведение артикулов к 4 цифрам
- Простая админка `/admin`
- Basic Auth для админки и API просмотра заказов

## Быстрый старт локально

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:push
npm run dev
```

## Переменные окружения
Смотри `.env.example`

## Основные маршруты
- `GET /health`
- `POST /api/orders`
- `GET /api/orders`
- `GET /api/orders/:id`
- `PATCH /api/orders/:id/status`
- `GET /admin`

## Пример создания заказа
```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "text": "1850 2\n0456 1\n0746 1",
    "comment": "Срочно"
  }'
```

## Как встраивать в твой текущий фронт
На клиенте вместо Netlify Function отправляй заказ сюда:

```js
await fetch('https://YOUR_BACKEND_DOMAIN/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: orderText,
    comment
  })
});
```

## Что загрузить в GitHub
Вариант 1:
- создать в репозитории папку `backend`
- залить в неё все эти файлы

Вариант 2:
- сделать отдельный репозиторий только под сервер

## Что сделать после загрузки
1. Создать PostgreSQL
2. Прописать переменные окружения
3. Запустить миграцию / `prisma db push`
4. Задеплоить сервер
5. На фронте поменять URL отправки заказа
