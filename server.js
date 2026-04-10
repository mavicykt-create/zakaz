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

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// limiter
const createOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Слишком много запросов. Попробуйте позже.' }
});

// ----------- HELPERS -----------

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
    const imageMatch = item.match(/<g:image_link>([\s\S]*?)<\/g:image_link>/i);

    if (!idMatch || !priceMatch) continue;

    const article = normalizeFeedArticle(idMatch[1]);
    const rawPrice = String(priceMatch[1]).trim();
    const description = descMatch ? String(descMatch[1]).trim() : '';
    const image = imageMatch ? String(imageMatch[1]).trim() : '';
    const price = parseFloat(rawPrice.replace(',', '.').replace(/[^\d.]/g, ''));

    if (!article || Number.isNaN(price)) continue;

    products[article] = {
      price,
      description,
      image
    };
  }

  return products;
}

async function createOrderRecord({ text = '', comment = '', customerName = '', customerPhone = '' }) {
  const parsed = parseOrderText(text);

  if (parsed.items.length === 0) {
    return {
      ok: false,
      status: 400,
      body: { success: false, error: 'Не удалось распознать заказ' }
    };
  }

  const order = await prisma.order.create({
    data: {
      rawText: text,
      comment,
      customerName,
      customerPhone,
      totalItems: parsed.totalItems,
      totalQuantity: parsed.totalQuantity,
      items: {
        create: parsed.items.map(i => ({
          article: i.article,
          quantity: i.quantity
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
      items: order.items
    }
  };
}

// ----------- ROUTES -----------

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (e) {
    res.status(500).json({ ok: false, db: false });
  }
});

app.get('/api/products', async (_req, res) => {
  try {
    const data = await loadProductsFeed();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'feed error' });
  }
});

app.post('/api/orders', createOrderLimiter, async (req, res, next) => {
  try {
    const result = await createOrderRecord(req.body || {});
    res.status(result.status).json(result.body);
  } catch (e) {
    next(e);
  }
});

app.post('/api/order', createOrderLimiter, async (req, res, next) => {
  try {
    const { rows = [], comment = '' } = req.body || {};

    const text = rows.map(r => `${r.article} ${r.quantity || 1}`).join('\n');

    const result = await createOrderRecord({ text, comment });
    res.status(result.status).json(result.body);
  } catch (e) {
    next(e);
  }
});

app.get('/api/orders', basicAuth, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, orders });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/orders/:id/status', basicAuth, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const status = String(req.body?.status || '').trim();

    const allowed = ['new', 'done', 'cancelled'];

    if (!Number.isInteger(orderId)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный ID заказа'
      });
    }

    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный статус'
      });
    }

    const order = await prisma.order.update({
      where: { id: orderId },
      data: { status },
      include: { items: true }
    });

    res.json({
      success: true,
      order
    });
  } catch (error) {
    next(error);
  }
});

// ----------- FRONT -----------

// раздаём файлы из корня
app.use(express.static(__dirname));

// главная
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// админка
app.get('/superadmin', basicAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'superadmin.html'));
});

// ----------- ERRORS -----------

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'Server error' });
});

// ----------- START -----------

async function start() {
  await prisma.$connect();
  app.listen(PORT, () => {
    console.log('Server started on port ' + PORT);
  });
}

start();
