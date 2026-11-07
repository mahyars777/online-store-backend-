import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./openapi.json" with { type: "json" };
import { pool, initDb } from "./db.js";

dotenv.config();
const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "1mb" }));
const uploadDir = process.env.UPLOAD_DIR || path.resolve("uploads");
fs.mkdirSync(uploadDir, { recursive: true });
app.use("/uploads", express.static(uploadDir, { fallthrough: false, maxAge: "1d" }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" })[file.mimetype];
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext || ".bin"}`);
  }
});
const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype))
});
const requireAdmin = (req, res, next) => {
  const configuredKey = process.env.ADMIN_API_KEY;
  if (!configuredKey || configuredKey === "change-this-admin-key-before-use")
    return res.status(503).json({ message: "کلید مدیر را در متغیر ADMIN_API_KEY تنظیم کن" });
  const suppliedKey = req.get("x-admin-key") || "";
  const a = Buffer.from(suppliedKey);
  const b = Buffer.from(configuredKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ message: "دسترسی مدیر معتبر نیست" });
  next();
};
const removeUploadedImage = async (imageUrl) => {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("/uploads/")) return;
  const filename = path.basename(imageUrl);
  if (!filename || filename !== imageUrl.slice("/uploads/".length)) return;
  await fs.promises.unlink(path.join(uploadDir, filename)).catch((e) => { if (e.code !== "ENOENT") throw e; });
};
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

// Admin endpoints: send x-admin-key with the ADMIN_API_KEY value.
app.get("/api/admin/products", requireAdmin, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT p.id, p.name, p.description, p.price::float AS price, p.image_url AS "imageUrl",
      p.stock, p.category_id AS "categoryId", c.name AS "categoryName", c.slug AS "categorySlug"
    FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC
  `);
  res.json(result.rows);
}));

app.post("/api/admin/products", requireAdmin, asyncRoute(async (req, res) => {
  const { name, description = "", price, imageUrl = "", stock = 0, categoryId } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || !Number.isFinite(Number(price)) || Number(price) < 0 ||
      !Number.isInteger(Number(stock)) || Number(stock) < 0 || !Number.isInteger(Number(categoryId)))
    return res.status(400).json({ message: "name، price، stock و categoryId معتبر لازم است" });
  const category = await pool.query("SELECT id FROM categories WHERE id=$1", [categoryId]);
  if (!category.rowCount) return res.status(400).json({ message: "دسته‌بندی پیدا نشد" });
  const result = await pool.query(`
    INSERT INTO products(name,description,price,image_url,stock,category_id)
    VALUES($1,$2,$3,$4,$5,$6)
    RETURNING id,name,description,price::float AS price,image_url AS "imageUrl",stock,category_id AS "categoryId"
  `, [name.trim(), String(description), Number(price), String(imageUrl), Number(stock), Number(categoryId)]);
  res.status(201).json(result.rows[0]);
}));

app.put("/api/admin/products/:id", requireAdmin, asyncRoute(async (req, res) => {
  const { name, description, price, imageUrl, stock, categoryId } = req.body ?? {};
  const current = await pool.query("SELECT * FROM products WHERE id=$1", [req.params.id]);
  if (!current.rowCount) return res.status(404).json({ message: "محصول پیدا نشد" });
  const old = current.rows[0];
  const next = {
    name: name === undefined ? old.name : String(name).trim(),
    description: description === undefined ? old.description : String(description),
    price: price === undefined ? Number(old.price) : Number(price),
    imageUrl: imageUrl === undefined ? old.image_url : String(imageUrl),
    stock: stock === undefined ? old.stock : Number(stock),
    categoryId: categoryId === undefined ? old.category_id : Number(categoryId)
  };
  if (!next.name || !Number.isFinite(next.price) || next.price < 0 || !Number.isInteger(next.stock) || next.stock < 0 || !Number.isInteger(next.categoryId))
    return res.status(400).json({ message: "اطلاعات محصول معتبر نیست" });
  const category = await pool.query("SELECT id FROM categories WHERE id=$1", [next.categoryId]);
  if (!category.rowCount) return res.status(400).json({ message: "دسته‌بندی پیدا نشد" });
  const result = await pool.query(`
    UPDATE products SET name=$1,description=$2,price=$3,image_url=$4,stock=$5,category_id=$6
    WHERE id=$7
    RETURNING id,name,description,price::float AS price,image_url AS "imageUrl",stock,category_id AS "categoryId"
  `, [next.name,next.description,next.price,next.imageUrl,next.stock,next.categoryId,req.params.id]);
  if (next.imageUrl !== old.image_url) await removeUploadedImage(old.image_url);
  res.json(result.rows[0]);
}));

app.delete("/api/admin/products/:id", requireAdmin, asyncRoute(async (req, res) => {
  const result = await pool.query("DELETE FROM products WHERE id=$1 RETURNING id,image_url", [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ message: "محصول پیدا نشد" });
  await removeUploadedImage(result.rows[0].image_url);
  res.json({ message: "محصول حذف شد", id: result.rows[0].id });
}));

app.post("/api/admin/upload", requireAdmin, (req, res) => {
  imageUpload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "حداکثر حجم تصویر ۵ مگابایت است" : "فایل تصویر معتبر نیست" });
    if (!req.file) return res.status(400).json({ message: "فایل تصویر با نام image ارسال کن (JPG, PNG, WebP یا GIF)" });
    res.status(201).json({ imageUrl: `/uploads/${req.file.filename}`, filename: req.file.filename, size: req.file.size, mimetype: req.file.mimetype });
  });
});

app.get("/api/admin/categories", requireAdmin, asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT id,name,slug FROM categories ORDER BY id");
  res.json(result.rows);
}));
app.post("/api/admin/categories", requireAdmin, asyncRoute(async (req, res) => {
  const { name, slug } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug))
    return res.status(400).json({ message: "name و slug معتبر لازم است؛ slug فقط حروف کوچک انگلیسی، عدد و خط تیره" });
  try {
    const result = await pool.query("INSERT INTO categories(name,slug) VALUES($1,$2) RETURNING id,name,slug", [name.trim(),slug]);
    res.status(201).json(result.rows[0]);
  } catch (e) { if (e.code === "23505") return res.status(409).json({ message: "این slug قبلاً استفاده شده است" }); throw e; }
}));
app.put("/api/admin/categories/:id", requireAdmin, asyncRoute(async (req, res) => {
  const { name, slug } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug))
    return res.status(400).json({ message: "name و slug معتبر لازم است" });
  try {
    const result = await pool.query("UPDATE categories SET name=$1,slug=$2 WHERE id=$3 RETURNING id,name,slug", [name.trim(),slug,req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: "دسته‌بندی پیدا نشد" });
    res.json(result.rows[0]);
  } catch (e) { if (e.code === "23505") return res.status(409).json({ message: "این slug قبلاً استفاده شده است" }); throw e; }
}));
app.delete("/api/admin/categories/:id", requireAdmin, asyncRoute(async (req, res) => {
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM products WHERE category_id=$1", [req.params.id]);
  if (count.rows[0].count) return res.status(409).json({ message: "ابتدا محصولات این دسته‌بندی را منتقل یا حذف کن" });
  const result = await pool.query("DELETE FROM categories WHERE id=$1 RETURNING id", [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ message: "دسته‌بندی پیدا نشد" });
  res.json({ message: "دسته‌بندی حذف شد", id: result.rows[0].id });
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
