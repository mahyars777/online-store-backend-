import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./openapi.json" with { type: "json" };
import { pool, initDb } from "./db.js";

dotenv.config();
const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:3000" }));
app.use(express.json());
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument, { customSiteTitle: "Store API Documentation" }));
app.get("/openapi.json", (_req, res) => res.json(swaggerDocument));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", database: "connected" });
}));

app.get("/api/categories", asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT c.id, c.name, c.slug, COUNT(p.id)::int AS product_count
    FROM categories c LEFT JOIN products p ON p.category_id=c.id
    GROUP BY c.id ORDER BY c.id
  `);
  res.json(result.rows);
}));

app.get("/api/products", asyncRoute(async (req, res) => {
  const page = Math.max(1, Math.floor(number(req.query.page, 1)));
  const limit = Math.min(50, Math.max(1, Math.floor(number(req.query.limit, 12))));
  const values = [];
  const where = [];
  if (req.query.search) {
    values.push(`%${String(req.query.search).slice(0, 100)}%`);
    where.push(`(p.name ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
  }
  if (req.query.category) {
    values.push(String(req.query.category));
    where.push(`c.slug = $${values.length}`);
  }
  if (req.query.minPrice !== undefined && Number.isFinite(Number(req.query.minPrice))) {
    values.push(Number(req.query.minPrice)); where.push(`p.price >= $${values.length}`);
  }
  if (req.query.maxPrice !== undefined && Number.isFinite(Number(req.query.maxPrice))) {
    values.push(Number(req.query.maxPrice)); where.push(`p.price <= $${values.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sort = req.query.sort === "price_asc" ? "p.price ASC" :
    req.query.sort === "price_desc" ? "p.price DESC" : "p.id ASC";
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM products p JOIN categories c ON c.id=p.category_id ${whereSql}`, values);
  const total = count.rows[0].total;
  const queryValues = [...values, limit, (page - 1) * limit];
  const result = await pool.query(`
    SELECT p.id, p.name, p.description, p.price::float AS price, p.image_url AS "imageUrl",
      p.stock, c.name AS "categoryName", c.slug AS "categorySlug"
    FROM products p JOIN categories c ON c.id=p.category_id
    ${whereSql} ORDER BY ${sort} LIMIT $${queryValues.length - 1} OFFSET $${queryValues.length}
  `, queryValues);
  res.json({ items: result.rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

app.get("/api/products/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT p.id, p.name, p.description, p.price::float AS price, p.image_url AS "imageUrl",
      p.stock, c.name AS "categoryName", c.slug AS "categorySlug"
    FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=$1
  `, [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ message: "محصول پیدا نشد" });
  res.json(result.rows[0]);
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!name?.trim() || !email?.trim() || typeof password !== "string" || password.length < 6)
    return res.status(400).json({ message: "نام، ایمیل و رمز حداقل ۶ کاراکتری لازم است" });
  try {
    const result = await pool.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,created_at AS \"createdAt\"",
      [name.trim(), email.trim().toLowerCase(), hash(password)]
    );
    res.status(201).json({ user: result.rows[0], message: "حساب آزمایشی ساخته شد" });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ message: "این ایمیل قبلاً ثبت شده است" });
    throw e;
  }
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ message: "ایمیل و رمز لازم است" });
  const result = await pool.query(
    "SELECT id,name,email FROM users WHERE email=$1 AND password_hash=$2",
    [String(email).toLowerCase(), hash(String(password))]
  );
  if (!result.rowCount) return res.status(401).json({ message: "ایمیل یا رمز نادرست است" });
  res.json({ user: result.rows[0], message: "ورود آزمایشی موفق بود", token: null });
}));

async function getCart(userId) {
  return pool.query(`
    SELECT p.id AS "productId", p.name, p.price::float AS price, p.image_url AS "imageUrl",
      p.stock, ci.quantity, (p.price * ci.quantity)::float AS "lineTotal"
    FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=$1 ORDER BY p.id
  `, [userId]);
}
app.get("/api/cart", asyncRoute(async (req, res) => {
  if (!req.query.userId) return res.status(400).json({ message: "userId لازم است" });
  const result = await getCart(req.query.userId);
  res.json({ items: result.rows, total: result.rows.reduce((s, x) => s + x.lineTotal, 0) });
}));

app.post("/api/cart/items", asyncRoute(async (req, res) => {
  const { userId, productId } = req.body ?? {};
  const quantity = Math.floor(number(req.body?.quantity, 1));
  if (!userId || !productId || quantity < 1) return res.status(400).json({ message: "userId، productId و quantity معتبر لازم است" });
  const product = await pool.query("SELECT stock FROM products WHERE id=$1", [productId]);
  if (!product.rowCount) return res.status(404).json({ message: "محصول پیدا نشد" });
  if (quantity > product.rows[0].stock) return res.status(400).json({ message: "موجودی کافی نیست" });
  const user = await pool.query("SELECT id FROM users WHERE id=$1", [userId]);
  if (!user.rowCount) return res.status(404).json({ message: "کاربر پیدا نشد؛ ابتدا ثبت‌نام کن" });
  await pool.query(`
    INSERT INTO cart_items(user_id,product_id,quantity) VALUES($1,$2,$3)
    ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=cart_items.quantity + EXCLUDED.quantity
  `, [userId, productId, quantity]);
  const cart = await getCart(userId);
  res.status(201).json({ items: cart.rows, total: cart.rows.reduce((s, x) => s + x.lineTotal, 0) });
}));

app.patch("/api/cart/items/:productId", asyncRoute(async (req, res) => {
  const { userId, quantity } = req.body ?? {};
  const qty = Math.floor(number(quantity, 0));
  if (!userId || qty < 1) return res.status(400).json({ message: "userId و quantity مثبت لازم است" });
  const product = await pool.query("SELECT stock FROM products WHERE id=$1", [req.params.productId]);
  if (!product.rowCount) return res.status(404).json({ message: "محصول پیدا نشد" });
  if (qty > product.rows[0].stock) return res.status(400).json({ message: "موجودی کافی نیست" });
  const result = await pool.query("UPDATE cart_items SET quantity=$1 WHERE user_id=$2 AND product_id=$3", [qty, userId, req.params.productId]);
  if (!result.rowCount) return res.status(404).json({ message: "این محصول در سبد نیست" });
  const cart = await getCart(userId);
  res.json({ items: cart.rows, total: cart.rows.reduce((s, x) => s + x.lineTotal, 0) });
}));

app.delete("/api/cart/items/:productId", asyncRoute(async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId لازم است" });
  await pool.query("DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2", [userId, req.params.productId]);
  const cart = await getCart(userId);
  res.json({ items: cart.rows, total: cart.rows.reduce((s, x) => s + x.lineTotal, 0) });
}));

app.post("/api/orders", asyncRoute(async (req, res) => {
  const { userId, shippingAddress } = req.body ?? {};
  if (!userId || !shippingAddress?.trim()) return res.status(400).json({ message: "userId و shippingAddress لازم است" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cart = await client.query(`
      SELECT p.id AS product_id, p.name, p.price, p.stock, ci.quantity
      FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=$1 FOR UPDATE
    `, [userId]);
    if (!cart.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ message: "سبد خرید خالی است" }); }
    for (const item of cart.rows) {
      if (item.quantity > item.stock) { await client.query("ROLLBACK"); return res.status(400).json({ message: `موجودی ${item.name} کافی نیست` }); }
    }
    const total = cart.rows.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
    const order = await client.query(
      "INSERT INTO orders(user_id,total,shipping_address) VALUES($1,$2,$3) RETURNING id,user_id,total::float AS total,shipping_address AS \"shippingAddress\",status,created_at AS \"createdAt\"",
      [userId, total, shippingAddress.trim()]
    );
    for (const item of cart.rows) {
      await client.query(
        "INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity) VALUES($1,$2,$3,$4,$5)",
        [order.rows[0].id, item.product_id, item.name, item.price, item.quantity]
      );
      await client.query("UPDATE products SET stock=stock-$1 WHERE id=$2", [item.quantity, item.product_id]);
    }
    await client.query("DELETE FROM cart_items WHERE user_id=$1", [userId]);
    await client.query("COMMIT");
    res.status(201).json({ ...order.rows[0], items: cart.rows.map(x => ({ productId: x.product_id, name: x.name, quantity: x.quantity, unitPrice: Number(x.price) })) });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}));

app.get("/api/orders", asyncRoute(async (req, res) => {
  if (!req.query.userId) return res.status(400).json({ message: "userId لازم است" });
  const orders = await pool.query(
    "SELECT id,total::float AS total,shipping_address AS \"shippingAddress\",status,created_at AS \"createdAt\" FROM orders WHERE user_id=$1 ORDER BY id DESC",
    [req.query.userId]
  );
  for (const order of orders.rows) {
    const items = await pool.query("SELECT product_id AS \"productId\",product_name AS name,unit_price::float AS \"unitPrice\",quantity FROM order_items WHERE order_id=$1", [order.id]);
    order.items = items.rows;
  }
  res.json(orders.rows);
}));

app.use((req, res) => res.status(404).json({ message: "مسیر پیدا نشد" }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "خطای داخلی سرور" });
});

const port = Number(process.env.PORT || 4000);
await initDb();
app.listen(port, () => console.log(`Store API is running at http://localhost:${port}`));
