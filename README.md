# Store API — تمرین فروشگاه اینترنتی با Next.js

یک REST API آموزشی با Node.js + Express + PostgreSQL؛ دیتابیس و اطلاعات نمونه با Docker اجرا می‌شوند. این پروژه برای تمرین فرانت‌اند است، نه استفاده در محصول واقعی.

## پیش‌نیازها
- Node.js نسخه 20 یا جدیدتر
- Docker Desktop و Docker Compose

## اجرا در ویندوز / ترمینال (Docker)
1. ZIP را استخراج کن و ترمینال را در پوشه پروژه باز کن.
2. فایل `.env.example` را به `.env` کپی کن و مقدار `ADMIN_API_KEY` را به یک مقدار محرمانه و طولانی تغییر بده. مثال PowerShell:
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
3. سرویس‌ها را بساز و اجرا کن:
   ```powershell
   docker compose up -d --build
   ```
4. در اولین اجرا، جدول‌ها و محصولات نمونه را بساز:
   ```powershell
   docker compose exec api npm run seed
   ```
5. بررسی سلامت: `http://localhost:4000/api/health`
6. Swagger: `http://localhost:4000/api-docs`

دفعات بعد برای روشن کردن سرویس‌های موجود: `docker compose up -d`
برای مشاهده لاگ API: `docker compose logs -f api`
برای توقف: `docker compose stop`
برای حذف کانتینرها و شبکه (بدون حذف اطلاعات): `docker compose down`
**از `docker compose down -v` استفاده نکن** مگر اینکه عمداً بخواهی دیتابیس و تصاویر آپلودشده حذف شوند.

### نگهداری دائمی تصاویر و دیتابیس
- PostgreSQL در Volume با نام `storebackend_store_db_data` ذخیره می‌شود.
- تصاویر آپلودی در Volume با نام `storebackend_store_uploads` و مسیر `/app/uploads` داخل کانتینر ذخیره می‌شوند.
- حذف و ساخت مجدد کانتینرها با `docker compose down` یا `docker compose up -d --build` این داده‌ها را پاک نمی‌کند.
- اگر قبلاً دیتابیس را با Compose قدیمی اجرا کرده‌ای و اطلاعات قبلی در Volume دیگری است، قبل از جایگزینی فایل‌ها از آن پشتیبان بگیر و Volume قبلی را حذف نکن. نام Volume قبلی را با `docker volume ls` بررسی کن.

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

## پنل مدیریت و آپلود تصویر
تمام مسیرهای `/api/admin/*` به هدر `x-admin-key` نیاز دارند. مقدار آن همان `ADMIN_API_KEY` در فایل `.env` است. در Swagger روی **Authorize** بزن و کلید را وارد کن.

### APIهای مدیریت
| Method | Endpoint | کاربرد |
|---|---|---|
| GET | `/api/admin/products` | فهرست محصولات مدیر |
| POST | `/api/admin/products` | ایجاد محصول |
| PUT | `/api/admin/products/:id` | ویرایش محصول |
| DELETE | `/api/admin/products/:id` | حذف محصول |
| POST | `/api/admin/upload` | آپلود تصویر با فیلد `image` در multipart/form-data |
| GET | `/api/admin/categories` | فهرست دسته‌بندی‌ها |
| POST | `/api/admin/categories` | ایجاد دسته‌بندی |
| PUT | `/api/admin/categories/:id` | ویرایش دسته‌بندی |
| DELETE | `/api/admin/categories/:id` | حذف دسته‌بندی بدون محصول |

### گردش کار آپلود تصویر
1. از فرانت‌اند تصویر را با `FormData` و نام فیلد `image` به `POST /api/admin/upload` بفرست.
2. هدر `x-admin-key` را اضافه کن.
3. پاسخ شامل `imageUrl` مانند `/uploads/1710000000-example.webp` است.
4. مقدار `imageUrl` را همراه نام، قیمت، توضیحات، موجودی و `categoryId` در درخواست ساخت/ویرایش محصول بفرست.
5. برای نمایش تصویر در فرانت‌اند، آدرس کامل را از ترکیب `http://localhost:4000` و `imageUrl` بساز؛ مثلاً `http://localhost:4000/uploads/...`.

نمونه فرانت‌اند:
```js
const formData = new FormData();
formData.append("image", file);
const uploaded = await fetch("http://localhost:4000/api/admin/upload", {
  method: "POST",
  headers: { "x-admin-key": adminKey },
  body: formData
}).then(r => r.json());
// uploaded.imageUrl را در payload محصول ذخیره کن.
```

محدودیت آپلود: حداکثر ۵ مگابایت و فرمت‌های JPEG، PNG، WebP و GIF. این احراز هویت با کلید ثابت برای تمرین محلی است؛ برای Production باید سیستم کاربران مدیر، هش رمز، نشست/JWT امن، مجوزدهی و HTTPS پیاده‌سازی شود. کلید مدیر را در متغیر `NEXT_PUBLIC_` قرار نده؛ چون در مرورگر قابل مشاهده می‌شود. درخواست‌های مدیریتی را از Server Route/Server Action امن Next.js عبور بده یا برای تمرین محلی آگاهانه هدر را در کلاینت استفاده کن.
