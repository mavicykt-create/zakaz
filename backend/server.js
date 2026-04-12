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

/* =========================
   🔥 LIVE USERS (НОВОЕ)
========================= */
const activeSessions = new Map();

setInterval(() => {
  const now = Date.now();

  for (const [id, session] of activeSessions) {
    if (now - session.updatedAt > 15000) {
      activeSessions.delete(id);
    }
  }
}, 5000);

/* ========================= */

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
  message: { success: false, error: 'Слишком много запросов.' }
});

/* =========================
   HEALTH
========================= */
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (error) {
    res.status(500).json({ ok: false, db: false });
  }
});

/* =========================
   🔥 LIVE API (НОВОЕ)
========================= */
app.post('/api/live', (req, res) => {
  const { sessionId, sum } = req.body;

  if (!sessionId) return res.json({ ok: false });

  activeSessions.set(sessionId, {
    sum: Number(sum || 0),
    updatedAt: Date.now()
  });

  res.json({ ok: true });
});

app.get('/api/live/stats', basicAuth, (req, res) => {
  let users = activeSessions.size;
  let total = 0;

  for (const s of activeSessions.values()) {
    total += s.sum;
  }

  res.json({
    users,
    total,
    avg: users ? Math.round(total / users) : 0
  });
});

/* =========================
   ORDERS
========================= */
app.post('/api/orders', createOrderLimiter, async (req, res, next) => {
  try {
    const { text = '', comment = '', customerName = '', customerPhone = '' } = req.body || {};
    const parsed = parseOrderText(text);

    if (parsed.items.length === 0) {
      return res.status(400).json({ success: false, error: 'Нет товаров' });
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

    res.status(201).json({
      success: true,
      orderId: order.id
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders', basicAuth, async (req, res, next) => {
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
    const status = String(req.body?.status || '');

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

/* ========================= */

app.use('/admin', basicAuth, express.static(publicDir));
app.use('/public', express.static(publicDir));

app.get('/', (_req, res) => {
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ success: false });
});

async function start() {
  try {
    await prisma.$connect();
    app.listen(PORT, () => {
      console.log(`Server started on ${PORT}`);
    });
  } catch (error) {
    process.exit(1);
  }
}

start();
