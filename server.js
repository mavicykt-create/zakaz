const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/products", async (req, res) => {
  try {
    const feedUrl = "https://milku.ru/site1/export-google-whatsp/";
    const response = await fetch(feedUrl);

    if (!response.ok) {
      return res.status(500).json({ error: "feed fetch failed" });
    }

    const xml = await response.text();
    const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    const products = {};

    for (const item of itemMatches) {
      const idMatch = item.match(/<g:id>([\s\S]*?)<\/g:id>/i);
      const priceMatch = item.match(/<g:price>([\s\S]*?)<\/g:price>/i);
      const descMatch = item.match(/<g:description>([\s\S]*?)<\/g:description>/i);

      if (!idMatch || !priceMatch) continue;

      const article = String(idMatch[1]).trim();
      const rawPrice = String(priceMatch[1]).trim();
      const description = descMatch ? String(descMatch[1]).trim() : "";
      const price = parseFloat(rawPrice.replace(",", ".").replace(/[^\d.]/g, ""));

      if (!article || Number.isNaN(price)) continue;

      products[article] = { price, description };
    }

    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message || "parse error" });
  }
});

app.post("/api/send", async (req, res) => {
  try {
    const text = req.body?.text || "";

    if (!text.trim()) {
      return res.status(400).send("empty text");
    }

    const tgRes = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text
        })
      }
    );

    if (!tgRes.ok) {
      const err = await tgRes.text();
      return res.status(500).send(err);
    }

    res.send("ok");
  } catch (e) {
    res.status(500).send(e.message || "error");
  }
});

app.post("/api/order", async (req, res) => {
  try {
    const { rows, comment } = req.body || {};

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "No rows" });
    }

    const lines = rows.map(r => `${r.article} - ${r.quantity}`);
    const text = [
      "Новая заявка",
      "",
      ...lines,
      comment ? "" : null,
      comment ? `Комментарий: ${comment}` : null
    ].filter(Boolean).join("\n");

    const tgRes = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text
        })
      }
    );

    const resultText = await tgRes.text();

    if (!tgRes.ok) {
      return res.status(500).json({ ok: false, telegram_error: resultText });
    }

    res.json({ ok: true, telegram_result: resultText });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server started on port " + PORT);
});
