import { pool, initDb } from "./db.js";

const categories = [
  ["موبایل و تبلت", "electronics"],
  ["لوازم جانبی", "accessories"],
  ["خانه و زندگی", "home"],
  ["پوشاک", "fashion"]
];
const products = [
  ["گوشی هوشمند Nova X", "گوشی مناسب استفاده روزمره با نمایشگر باکیفیت", 18990000, "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=800&q=80", 18, "electronics"],
  ["هدفون بی‌سیم AirBeat", "هدفون سبک با صدای شفاف و باتری بادوام", 2490000, "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80", 35, "accessories"],
  ["ساعت هوشمند Pulse", "ساعت هوشمند برای فعالیت‌های روزانه", 3790000, "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80", 12, "accessories"],
  ["کوله‌پشتی شهری", "کوله‌پشتی سبک با محفظه لپ‌تاپ", 1590000, "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80", 20, "fashion"],
  ["چراغ رومیزی", "چراغ مینیمال مناسب میز کار و مطالعه", 890000, "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80", 9, "home"],
  ["کیبورد مکانیکی", "کیبورد مناسب برنامه‌نویسی و تایپ", 3290000, "https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=800&q=80", 14, "accessories"],
  ["کفش روزمره", "کفش راحت برای استفاده روزانه", 2190000, "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80", 16, "fashion"],
  ["ماگ سرامیکی", "ماگ ساده برای قهوه و چای", 290000, "https://images.unsplash.com/photo-1514228742587-6b1558f0f8e1?auto=format&fit=crop&w=800&q=80", 50, "home"],
  ["پایه لپ‌تاپ", "پایه ارگونومیک برای میز کار", 780000, "https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=800&q=80", 22, "accessories"],
  ["تی‌شرت ساده", "تی‌شرت راحت با طراحی مینیمال", 490000, "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80", 40, "fashion"],
  ["اسپیکر بلوتوثی", "اسپیکر جمع‌وجور برای خانه و سفر", 1390000, "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=800&q=80", 11, "electronics"],
  ["گلدان دکوراتیو", "گلدان مناسب دکور خانه و دفتر", 360000, "https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=800&q=80", 27, "home"]
];

await initDb();
for (const [name, slug] of categories) {
  await pool.query("INSERT INTO categories(name, slug) VALUES($1,$2) ON CONFLICT(slug) DO NOTHING", [name, slug]);
}
for (const p of products) {
  const exists = await pool.query("SELECT id FROM products WHERE name=$1", [p[0]]);
  if (!exists.rowCount) {
    const cat = await pool.query("SELECT id FROM categories WHERE slug=$1", [p[5]]);
    await pool.query(
      "INSERT INTO products(name,description,price,image_url,stock,category_id) VALUES($1,$2,$3,$4,$5,$6)",
      [p[0], p[1], p[2], p[3], p[4], cat.rows[0].id]
    );
  }
}
console.log("Database seeded.");
await pool.end();
