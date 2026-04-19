import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import webpush from 'web-push';
import { parseOrderText } from './src/utils/parseOrderText.js';
import { basicAuth } from './src/middleware/basicAuth.js';

const prisma = new PrismaClient();
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const PUSH_STORAGE_DIR =
  process.env.PUSH_STORAGE_DIR ||
  (process.env.NODE_ENV === 'production' ? '/data' : path.join(__dirname, 'data'));
const PUSH_STORAGE_FILE = path.join(PUSH_STORAGE_DIR, 'push-subscriptions.json');
const PUSH_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PUSH_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const PUSH_CONTACT_EMAIL = process.env.PUSH_CONTACT_EMAIL || 'admin@example.com';

if (PUSH_PUBLIC_KEY && PUSH_PRIVATE_KEY) {
  webpush.setVapidDetails(`mailto:${PUSH_CONTACT_EMAIL}`, PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY);
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const createOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Слишком много запросов. Попробуйте позже.' }
});

function normalizeFeedArticle(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0').slice(-4);
}

async function loadProductsFeed() {
  const feedUrl = 'https://milku.ru/site1/export-google-whatsp/';
  const response = await fetch(feedUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`feed fetch failed: ${response.status}`);

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

    products[article] = { price, description, image };
  }

  return products;
}

async function createOrderRecord({ text = '', comment = '', customerName = '', customerPhone = '' }) {
  const parsed = parseOrderText(text);
  if (parsed.items.length === 0) {
    return { ok: false, status: 400, body: { success: false, error: 'Не удалось распознать заказ' } };
  }

  const order = await prisma.order.create({
    data: {
      rawText: text,
      comment,
      customerName,
      customerPhone,
      totalItems: parsed.totalItems,
      totalQuantity: parsed.totalQuantity,
      items: { create: parsed.items.map((i) => ({ article: i.article, quantity: i.quantity })) }
    },
    include: { items: true }
  });

  return { ok: true, status: 201, body: { success: true, orderId: order.id, items: order.items } };
}

async function ensurePushStorage() {
  await fs.mkdir(PUSH_STORAGE_DIR, { recursive: true });
  try {
    await fs.access(PUSH_STORAGE_FILE);
  } catch {
    await fs.writeFile(PUSH_STORAGE_FILE, '[]', 'utf8');
  }
}

async function readPushSubscriptions() {
  await ensurePushStorage();
  try {
    const raw = await fs.readFile(PUSH_STORAGE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writePushSubscriptions(subscriptions) {
  await ensurePushStorage();
  await fs.writeFile(PUSH_STORAGE_FILE, JSON.stringify(subscriptions, null, 2), 'utf8');
}

function isValidPushSubscription(subscription) {
  return !!(
    subscription &&
    typeof subscription === 'object' &&
    typeof subscription.endpoint === 'string' &&
    subscription.endpoint.trim()
  );
}

function pushEnabled() {
  return Boolean(PUSH_PUBLIC_KEY && PUSH_PRIVATE_KEY);
}

async function addPushSubscription(subscription) {
  const subscriptions = await readPushSubscriptions();
  if (!subscriptions.some((item) => item.endpoint === subscription.endpoint)) {
    subscriptions.push(subscription);
    await writePushSubscriptions(subscriptions);
  }
}

async function removePushSubscriptionByEndpoint(endpoint) {
  const subscriptions = await readPushSubscriptions();
  const next = subscriptions.filter((item) => item.endpoint !== endpoint);
  if (next.length !== subscriptions.length) {
    await writePushSubscriptions(next);
  }
  return next.length;
}

async function sendPushToAll({ title, body, url = '/' }) {
  if (!pushEnabled()) {
    return { sent: 0, failed: 0, total: 0, removed: 0, error: 'PUSH_NOT_CONFIGURED' };
  }

  const subscriptions = await readPushSubscriptions();
  const payload = JSON.stringify({
    title: String(title || 'Сладкая планета'),
    body: String(body || ''),
    url: String(url || '/')
  });

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload);
      sent += 1;
    } catch (error) {
      failed += 1;
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await removePushSubscriptionByEndpoint(subscription.endpoint);
        removed += 1;
      } else {
        console.error('Push send error:', error?.message || error);
      }
    }
  }

  return { total: subscriptions.length, sent, failed, removed };
}

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch {
    res.status(500).json({ ok: false, db: false });
  }
});

app.get('/api/products', async (_req, res) => {
  try {
    res.json(await loadProductsFeed());
  } catch {
    res.status(500).json({ error: 'feed error' });
  }
});

app.get('/api/push/config', async (_req, res, next) => {
  try {
    const subscriptions = await readPushSubscriptions();
    res.json({
      success: true,
      enabled: pushEnabled(),
      publicKey: PUSH_PUBLIC_KEY || '',
      subscriptions: subscriptions.length
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/push/subscribe', async (req, res, next) => {
  try {
    if (!pushEnabled()) {
      return res.status(503).json({ success: false, error: 'Push не настроен на сервере' });
    }

    const subscription = req.body;
    if (!isValidPushSubscription(subscription)) {
      return res.status(400).json({ success: false, error: 'Некорректная push-подписка' });
    }

    await addPushSubscription(subscription);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/push/unsubscribe', async (req, res, next) => {
  try {
    const endpoint = String(req.body?.endpoint || '').trim();
    if (!endpoint) {
      return res.status(400).json({ success: false, error: 'Не передан endpoint' });
    }

    const subscriptions = await removePushSubscriptionByEndpoint(endpoint);
    res.json({ success: true, subscriptions });
  } catch (error) {
    next(error);
  }
});

app.get('/api/push/stats', basicAuth, async (_req, res, next) => {
  try {
    const subscriptions = await readPushSubscriptions();
    res.json({ success: true, enabled: pushEnabled(), subscriptions: subscriptions.length });
  } catch (error) {
    next(error);
  }
});

app.post('/api/push/send', basicAuth, async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim() || 'Сладкая планета';
    const body = String(req.body?.body || '').trim();
    const url = String(req.body?.url || '/').trim() || '/';

    if (!body) {
      return res.status(400).json({ success: false, error: 'Введите текст уведомления' });
    }

    const result = await sendPushToAll({ title, body, url });
    if (result.error === 'PUSH_NOT_CONFIGURED') {
      return res.status(503).json({
        success: false,
        error: 'На сервере не заданы VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY'
      });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', createOrderLimiter, async (req, res, next) => {
  try {
    const result = await createOrderRecord(req.body || {});
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.post('/api/order', createOrderLimiter, async (req, res, next) => {
  try {
    const { rows = [], comment = '' } = req.body || {};
    const text = rows.map((r) => `${r.article} ${r.quantity || 1}`).join('\n');
    const result = await createOrderRecord({ text, comment });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders', basicAuth, async (_req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, orders });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/orders/:id/status', basicAuth, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const status = String(req.body?.status || '').trim();
    const allowed = ['new', 'done', 'cancelled'];

    if (!Number.isInteger(orderId)) {
      return res.status(400).json({ success: false, error: 'Некорректный ID заказа' });
    }

    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: 'Некорректный статус' });
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

app.use(express.static(__dirname));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/superadmin', basicAuth, (_req, res) => res.sendFile(path.join(__dirname, 'superadmin.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'Server error' });
});

async function start() {
  await prisma.$connect();
  await ensurePushStorage();
  app.listen(PORT, () => console.log('Server started on port ' + PORT));
}

start();
