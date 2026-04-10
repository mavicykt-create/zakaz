import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { parseOrderText } from './src/utils/parseOrderText.js';
import { basicAuth } from './src/middleware/basicAuth.js';

const prisma = new PrismaClient();
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

const createOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Слишком много запросов. Попробуйте чуть позже.' }
});

function normalizeFeedArticle(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0').slice(-4);
}

async function loadProductsFeed() {
  const feedUrl = 'https://milku.ru/site1/export-google-whatsp/';
  const response = await fetch(feedUrl, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`feed fetch failed: ${response.status}`);
  }

  const xml = await response.text();
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  const products = {};

  for (const item of itemMatches) {
    const idMatch = item.match(/<g:id>([\s\S]*?)<\/g:id>/i);
    const priceMatch = item.match(/<g:price>([\s\S]*?)<\/g:price>/i);
    const descMatch = item.match(/<g:description>([\s\S]*?)<\/g:description>/i);

    if (!idMatch || !priceMatch) continue;

    const article = normalizeFeedArticle(idMatch[1]);
    const rawPrice = String(priceMatch[1]).trim();
    const description = descMatch ? String(descMatch[1]).trim() : '';
    const price = parseFloat(rawPrice.replace(',', '.').replace(/[^\d.]/g, ''));

    if (!article || Number.isNaN(price)) continue;

    products[article] = {
      price,
      description
    };
  }

  return products;
}

async function createOrderRecord({
  text = '',
  comment = '',
  customerName = '',
  customerPhone = ''
}) {
  const parsed = parseOrderText(text);

  if (parsed.items.length === 0) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'Не удалось найти позиции заказа. Проверьте текст.'
      }
    };
  }

  const order = await prisma.order.create({
    data: {
      rawText: text,
      comment: String(comment || '').trim(),
      customerName: String(customerName || '').trim(),
      customerPhone: String(customerPhone || '').trim(),
      totalItems: parsed.totalItems,
      totalQuantity: parsed.totalQuantity,
      items: {
        create: parsed.items.map((item) => ({
          article: item.article,
          quantity: item.quantity
        }))
      }
    },
    include: { items: true }
  });

  return {
    ok: true,
    status: 201,
    body: {
      success: true,
      orderId: order.id,
      totalItems: order.totalItems,
      totalQuantity: order.totalQuantity,
      items: order.items
    }
  };
}

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (error) {
    res.status(500).json({ ok: false, db: false, error: error.message });
  }
});

// Совместимость со старым фронтом: загрузка цен
app.get('/api/products', async (_req, res) => {
  try {
    const products = await loadProductsFeed();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message || 'parse error' });
  }
});

// Новый API
app.post('/api/orders', createOrderLimiter, async (req, res, next) => {
  try {
    const { text = '', comment = '', customerName = '', customerPhone = '' } = req.body || {};
    const result = await createOrderRecord({ text, comment, customerName, customerPhone });
    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

// Совместимость со старым фронтом: rows -> text
app.post('/api/order', createOrderLimiter, async (req, res, next) => {
  try {
    const { rows = [], comment = '', customerName = '', customerPhone = '' } = req.body || {};

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No rows' });
    }

    const text = rows
      .map((row) => {
        const article = String(row.article || '').trim();
        const quantity = Number(row.quantity || 1);
        return `${article} ${Number.isFinite(quantity) && quantity > 0 ? quantity : 1}`;
      })
      .join('\n');

    const result = await createOrderRecord({ text, comment, customerName, customerPhone });
    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders', basicAuth, async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where =
      status && ['new', 'processing', 'done', 'cancelled'].includes(status)
        ? { status }
        : {};

    const orders = await prisma.order.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, orders });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders/:id', basicAuth, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId)) {
      return res.status(400).json({ success: false, error: 'Некорректный ID заказа.' });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Заказ не найден.' });
    }

    res.json({ success: true, order });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/orders/:id/status', basicAuth, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const status = String(req.body?.status || '').trim();
    const allowed = ['new', 'processing', 'done', 'cancelled'];

    if (!Number.isInteger(orderId)) {
      return res.status(400).json({ success: false, error: 'Некорректный ID заказа.' });
    }

    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: 'Некорректный статус.' });
    }

    const order = await prisma.order.update({
      where: { id: orderId },
      data: { status },
      include: { items: true }
    });

    res.json({ success: true, order });
  } catch (error) {
    next(error);
  }
});

app.use('/admin', basicAuth, express.static(publicDir));
app.use('/public', express.static(publicDir));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'zakaz-backend',
    health: '/health',
    admin: '/admin',
    products: '/api/products',
    createOrderLegacy: 'POST /api/order',
    createOrder: 'POST /api/orders'
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    success: false,
    error: 'Внутренняя ошибка сервера.'
  });
});

async function start() {
  try {
    await prisma.$connect();
    app.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
}

start();
