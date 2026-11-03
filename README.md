# Store API — تمرین فروشگاه اینترنتی با Next.js

یک REST API آموزشی با Node.js + Express + PostgreSQL؛ دیتابیس و اطلاعات نمونه با Docker اجرا می‌شوند. این پروژه برای تمرین فرانت‌اند است، نه استفاده در محصول واقعی.

## پیش‌نیازها
- Node.js نسخه 20 یا جدیدتر
- Docker Desktop و Docker Compose

## اجرا در ویندوز / ترمینال
1. فایل ZIP را استخراج کن و داخل پوشه پروژه برو.
2. ترمینال را در همان پوشه باز کن.
3. دیتابیس را اجرا کن:
   ```bash
   docker compose up -d db
   ```
4. فایل تنظیمات را کپی کن:
   - ویندوز CMD: `copy .env.example .env`
   - PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
5. وابستگی‌ها را نصب و API را اجرا کن:
   ```bash
   npm install
   npm run seed
   npm run dev
   ```
   دستور `npm run seed` جدول‌ها را می‌سازد و محصولات نمونه را درج می‌کند؛ اجرای مجدد آن محصولات تکراری ایجاد نمی‌کند.
6. مرورگر را باز کن: `http://localhost:4000/api/health`

برای توقف دیتابیس: `docker compose down`
برای حذف دیتابیس و تمام اطلاعاتش: `docker compose down -v`

## اتصال Next.js
در `.env.local` پروژه Next.js بنویس:
```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```
نمونه درخواست:
```js
const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/products`);
if (!res.ok) throw new Error("دریافت محصولات ناموفق بود");
const data = await res.json();
```
این متغیر فقط برای API عمومی مناسب است؛ هیچ secret یا رمز عبوری را با پیشوند `NEXT_PUBLIC_` قرار نده.

## Swagger — مستندات تعاملی API
پس از اجرای `npm run dev`، آدرس `http://localhost:4000/api-docs` را باز کن. هر Endpoint را باز کن، روی **Try it out** بزن، پارامترها یا JSON را وارد کن و **Execute** را بزن. برای دریافت فایل OpenAPI به `http://localhost:4000/openapi.json` برو.

## API endpoints
همه پاسخ‌ها JSON هستند. مسیر پایه: `http://localhost:4000/api`

| Method | Endpoint | توضیح |
|---|---|---|
| GET | `/health` | بررسی وضعیت API و دیتابیس |
| GET | `/categories` | فهرست دسته‌بندی‌ها |
| GET | `/products` | فهرست محصولات؛ فیلتر و صفحه‌بندی |
| GET | `/products/:id` | جزئیات یک محصول |
| POST | `/auth/register` | ساخت حساب آزمایشی |
| POST | `/auth/login` | ورود آزمایشی |
| GET | `/cart?userId=1` | مشاهده سبد خرید |
| POST | `/cart/items` | افزودن محصول به سبد |
| PATCH | `/cart/items/:productId` | تغییر تعداد یک محصول در سبد |
| DELETE | `/cart/items/:productId?userId=1` | حذف محصول از سبد |
| POST | `/orders` | ثبت سفارش از سبد کاربر |
| GET | `/orders?userId=1` | تاریخچه سفارش‌های کاربر |

### نمونه فیلتر محصولات
- `GET /api/products?search=phone`
- `GET /api/products?category=electronics`
- `GET /api/products?minPrice=100&maxPrice=1000`
- `GET /api/products?sort=price_asc`
- `GET /api/products?page=1&limit=8`

پاسخ لیست محصولات شکل زیر دارد:
```json
{
  "items": [],
  "pagination": { "page": 1, "limit": 12, "total": 0, "totalPages": 0 }
}
```

### نمونه payload
ثبت‌نام:
```json
{ "name": "Demo User", "email": "demo@example.com", "password": "secret123" }
```
ورود:
```json
{ "email": "demo@example.com", "password": "secret123" }
```
افزودن به سبد:
```json
{ "userId": 1, "productId": 1, "quantity": 2 }
```
ثبت سفارش:
```json
{ "userId": 1, "shippingAddress": "Tehran, Example Street" }
```

## نکته مهم برای تمرین
برای راحتی تمرین، endpointهای سبد و سفارش `userId` را مستقیم می‌گیرند و login توکن واقعی صادر نمی‌کند. رمز عبور با SHA-256 هش می‌شود، اما این پروژه **احراز هویت امن یا مناسب production نیست**. در پروژه واقعی از bcrypt/argon2، session یا JWT، اعتبارسنجی کامل، مجوزدهی سمت سرور، محدودسازی درخواست و مدیریت secrets استفاده کن. قیمت نهایی سفارش از دیتابیس محاسبه می‌شود.
