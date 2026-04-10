const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const ORDERS_FILE = "./orders.json";

app.use(express.json());
app.use(express.static(__dirname));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/order", (req, res) => {
  try {
    const { rows, comment } = req.body || {};

    if (!rows || !rows.length) {
      return res.status(400).json({ error: "No rows" });
    }

    const order = {
      id: Date.now(),
      date: new Date().toISOString(),
      rows,
      comment
    };

    let orders = [];

    if (fs.existsSync(ORDERS_FILE)) {
      orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
    }

    orders.push(order);

    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));

    res.json({ ok: true, id: order.id });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/orders", (req, res) => {
  try {
    if (!fs.existsSync(ORDERS_FILE)) return res.json([]);

    const data = fs.readFileSync(ORDERS_FILE, "utf-8");
    res.json(JSON.parse(data));

  } catch (e) {
    res.status(500).json({ error: "read error" });
  }
});

app.get("/superadmin", (req, res) => {
  res.sendFile(path.join(__dirname, "superadmin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server started on port " + PORT);
});
