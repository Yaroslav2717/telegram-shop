/**
 * Каталог товаров с базой данных SQLite, админ-панелью и интеграцией с Telegram-ботом.
 * Работает на стандартной библиотеке Node.js (Node 22+) без сторонних зависимостей.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.db');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Создаем необходимые директории, если их нет
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Инициализация базы данных SQLite
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    category TEXT DEFAULT 'Общее',
    image_url TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_comment TEXT,
    items_json TEXT NOT NULL,
    total_price REAL NOT NULL,
    status TEXT DEFAULT 'Новый',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Инициализация настроек по умолчанию
function getSetting(key, defaultValue = '') {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(key, String(value));
}

// Установка начального пароля админа, если не установлен
if (!getSetting('admin_password')) {
  setSetting('admin_password', 'admin123');
}

// Заполнение базы демо-товарами, если каталог пуст
const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
if (productCount === 0) {
  const demoProducts = [
    {
      title: 'Премиальный крафтовый набор «Noir Reserve»',
      description: 'Эксклюзивная подборка для истинных ценителей. Включает подарочный бокс, аксессуары из натурального дерева и фирменную гравировку.',
      price: 199,
      category: 'Наборы',
      image_url: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=800&q=80'
    },
    {
      title: 'Винтажный механический хронограф «Aero 1974»',
      description: 'Сапфировое стекло, стальной корпус 41мм, японский мануфактурный калибр. Водонепроницаемость 10 ATM.',
      price: 749,
      category: 'Часы & Аксессуары',
      image_url: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80'
    },
    {
      title: 'Кожаный дорожный несессер «Gentleman Traveler»',
      description: 'Натуральная итальянская кожа ручной выделки. Вместительные отделения для гигиенических принадлежностей и аксессуаров.',
      price: 249,
      category: 'Кожаные изделия',
      image_url: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80'
    },
    {
      title: 'Коллекционная зажигалка «Titan Brass»',
      description: 'Массивная латунная бензиновая зажигалка с винтажной текстурой и гравировкой. Ветроустойчивое пламя.',
      price: 139,
      category: 'Аксессуары',
      image_url: 'https://images.unsplash.com/photo-1582533561751-ef6f6ab93a2e?auto=format&fit=crop&w=800&q=80'
    },
    {
      title: 'Набор дегустационных бокалов «Glencairn Crystal»',
      description: 'Кристально чистое стекло особой формы для полного раскрытия аромата благородных напитков. В наборе 2 шт.',
      price: 159,
      category: 'Бар & Посуда',
      image_url: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=800&q=80'
    },
    {
      title: 'Хьюмидор из кедра «Havana Classic»',
      description: 'Внутренняя отделка из испанского кедра, точный аналоговый гигрометр, золоченая фурнитура. Вместимость до 25 шт.',
      price: 399,
      category: 'Наборы',
      image_url: 'https://images.unsplash.com/photo-1527061011665-3652c757a4d4?auto=format&fit=crop&w=800&q=80'
    }
  ];

  const insertStmt = db.prepare(`
    INSERT INTO products (title, description, price, category, image_url)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const prod of demoProducts) {
    insertStmt.run(prod.title, prod.description, prod.price, prod.category, prod.image_url);
  }
  console.log(`[DB] Добавлено ${demoProducts.length} демонстрационных товаров (в злотых).`);
} else {
  // Конвертация существующих старых рублевых цен в злотые (если > 1000)
  db.exec("UPDATE products SET price = ROUND(price / 25) WHERE price > 1000;");
}

// Активные сессии админов
const activeAdminTokens = new Set();

// Отправка уведомления в Telegram-бот
async function sendTelegramMessage(messageText) {
  const botToken = getSetting('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || '');
  const chatId = getSetting('telegram_chat_id', process.env.TELEGRAM_CHAT_ID || '');

  if (!botToken || !chatId) {
    return {
      success: false,
      reason: 'Telegram Bot Token или Chat ID не настроены в админ-панели.'
    };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        parse_mode: 'HTML'
      })
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      console.error('[Telegram API Error]', data);
      return { success: false, reason: data.description || 'Ошибка Telegram API' };
    }
    return { success: true };
  } catch (err) {
    console.error('[Telegram Fetch Error]', err);
    return { success: false, reason: err.message };
  }
}

// Установка кнопки меню (Web App) в Telegram-боте
async function updateTelegramMenuButton(botToken, appUrl) {
  if (!botToken) return;
  try {
    const body = appUrl ? {
      menu_button: {
        type: 'web_app',
        text: '🛍 Магазин',
        web_app: { url: appUrl }
      }
    } : {
      menu_button: { type: 'default' }
    };

    const res = await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    console.log('[Telegram Menu Button Updated]', d);
  } catch (err) {
    console.error('[Telegram Menu Button Error]', err.message);
  }
}

// Фоновый опрос Telegram для мгновенного ответа на команду /start с кнопкой магазина
let lastUpdateId = 0;
async function startTelegramBotListener() {
  while (true) {
    const token = getSetting('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || '');
    if (!token) {
      await new Promise(r => setTimeout(r, 4000));
      continue;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const upd of data.result) {
            lastUpdateId = upd.update_id;
            if (upd.message && upd.message.text) {
              const msg = upd.message;
              const text = msg.text.trim();

              if (text.startsWith('/start')) {
                const appUrl = getSetting('app_url', '');
                const inlineKeyboard = appUrl ? [
                  [{ text: '🛍 Открыть каталог товаров', web_app: { url: appUrl } }]
                ] : undefined;

                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: msg.chat.id,
                    text: '👋 <b>Добро пожаловать в наш магазин!</b>\n\nНажмите на кнопку ниже (или кнопку меню «🛍 Магазин» в левом нижнем углу), чтобы открыть каталог товаров прямо внутри Telegram:',
                    parse_mode: 'HTML',
                    reply_markup: inlineKeyboard ? { inline_keyboard: inlineKeyboard } : undefined
                  })
                });
              }
            }
          }
        }
      } else {
        await new Promise(r => setTimeout(r, 4000));
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

// Запускаем фоновый слушатель Telegram
startTelegramBotListener();

// Форматирование заказа в HTML-сообщение для Telegram
function formatOrderForTelegram(order, items) {
  const itemsText = items.map((item, index) => {
    const lineTotal = (item.price * item.quantity).toLocaleString('pl-PL');
    return `${index + 1}. <b>${escapeHtml(item.title)}</b>\n   └ ${item.quantity} шт. × ${item.price.toLocaleString('pl-PL')} zł = <b>${lineTotal} zł</b>`;
  }).join('\n');

  const formattedDate = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  const totalFormatted = order.total_price.toLocaleString('pl-PL');

  return `🔥 <b>НОВЫЙ ЗАКАЗ #${order.id}</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Клиент:</b> ${escapeHtml(order.customer_name)}
📞 <b>Телефон / Контакт:</b> ${escapeHtml(order.customer_phone)}
💬 <b>Комментарий:</b> ${escapeHtml(order.customer_comment || 'Не указан')}
━━━━━━━━━━━━━━━━━━
🛒 <b>Состав заказа:</b>
${itemsText}
━━━━━━━━━━━━━━━━━━
💰 <b>ИТОГО К ОПЛАТЕ: ${totalFormatted} zł</b>
🕒 <i>${formattedDate}</i>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Парсинг JSON тела запроса
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Ограничение размера 15MB (для картинок base64)
      if (body.length > 15 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// MIME-типы для статических файлов
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Функция проверки авторизации админа
function isAdmin(req) {
  const token = req.headers['x-admin-token'] || '';
  return activeAdminTokens.has(token);
}

// Основной обработчик запросов HTTP
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Хелперы ответа
  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
  };

  const sendError = (statusCode, message) => {
    sendJson(statusCode, { error: message });
  };

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-token'
    });
    return res.end();
  }

  try {
    // ==========================================
    // ПУБЛИЧНЫЙ API: ТОВАРЫ И ЗАКАЗЫ
    // ==========================================

    // Получить активные товары с каталога
    if (method === 'GET' && pathname === '/api/products') {
      const category = parsedUrl.searchParams.get('category');
      const search = parsedUrl.searchParams.get('search');

      let query = 'SELECT * FROM products WHERE is_active = 1';
      const params = [];

      if (category && category !== 'Все') {
        query += ' AND category = ?';
        params.push(category);
      }

      if (search) {
        query += ' AND (title LIKE ? OR description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }

      query += ' ORDER BY id DESC';
      const stmt = db.prepare(query);
      const products = stmt.all(...params);

      // Получаем также список уникальных категорий
      const categoriesRows = db.prepare('SELECT DISTINCT category FROM products WHERE is_active = 1').all();
      const categories = ['Все', ...categoriesRows.map(r => r.category).filter(Boolean)];

      return sendJson(200, { products, categories });
    }

    // Получить отдельный товар
    if (method === 'GET' && pathname.startsWith('/api/products/')) {
      const id = parseInt(pathname.split('/')[3], 10);
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!product) return sendError(404, 'Товар не найден');
      return sendJson(200, { product });
    }

    // Оформить новый заказ
    if (method === 'POST' && pathname === '/api/orders') {
      const body = await parseJsonBody(req);
      const { customer_name, customer_phone, customer_comment, items } = body;

      if (!customer_name || !customer_phone) {
        return sendError(400, 'Укажите ваше имя и контактный телефон/никнейм');
      }

      if (!Array.isArray(items) || items.length === 0) {
        return sendError(400, 'Корзина пуста');
      }

      // Вычисляем общую сумму и проверяем актуальность товаров
      let total_price = 0;
      const orderItems = [];

      for (const item of items) {
        const prod = db.prepare('SELECT id, title, price FROM products WHERE id = ?').get(item.id);
        if (prod) {
          const qty = Math.max(1, parseInt(item.quantity || 1, 10));
          total_price += prod.price * qty;
          orderItems.push({
            id: prod.id,
            title: prod.title,
            price: prod.price,
            quantity: qty
          });
        }
      }

      if (orderItems.length === 0) {
        return sendError(400, 'Товары из заказа не найдены в каталоге');
      }

      // Сохраняем заказ в базу данных
      const insertOrder = db.prepare(`
        INSERT INTO orders (customer_name, customer_phone, customer_comment, items_json, total_price, status)
        VALUES (?, ?, ?, ?, ?, 'Новый')
      `);
      const info = insertOrder.run(
        customer_name.trim(),
        customer_phone.trim(),
        (customer_comment || '').trim(),
        JSON.stringify(orderItems),
        total_price
      );

      const orderId = Number(info.lastInsertRowid);
      const savedOrder = {
        id: orderId,
        customer_name,
        customer_phone,
        customer_comment,
        total_price
      };

      // Отправляем уведомление в Telegram-бот
      const telegramMessage = formatOrderForTelegram(savedOrder, orderItems);
      const telegramResult = await sendTelegramMessage(telegramMessage);

      return sendJson(201, {
        success: true,
        orderId: orderId,
        total: total_price,
        telegramNotified: telegramResult.success,
        telegramMessage: telegramResult.success ? 'Уведомление отправлено в Telegram' : telegramResult.reason
      });
    }

    // ==========================================
    // АДМИН-ПАНЕЛЬ API
    // ==========================================

    // Авторизация администратора
    if (method === 'POST' && pathname === '/api/admin/login') {
      const { password } = await parseJsonBody(req);
      const adminPassword = getSetting('admin_password', 'admin123');

      if (password === adminPassword) {
        const token = crypto.randomBytes(32).toString('hex');
        activeAdminTokens.add(token);
        return sendJson(200, { success: true, token });
      } else {
        return sendError(401, 'Неверный пароль администратора');
      }
    }

    // Проверка статуса входа
    if (method === 'GET' && pathname === '/api/admin/check') {
      return sendJson(200, { authenticated: isAdmin(req) });
    }

    // Все последующие роуты требуют токен администратора
    if (pathname.startsWith('/api/admin/')) {
      if (!isAdmin(req)) {
        return sendError(401, 'Требуется авторизация администратора');
      }

      // Выход администратора
      if (method === 'POST' && pathname === '/api/admin/logout') {
        const token = req.headers['x-admin-token'];
        activeAdminTokens.delete(token);
        return sendJson(200, { success: true });
      }

      // Статистика дашборда
      if (method === 'GET' && pathname === '/api/admin/stats') {
        const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
        const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
        const totalRevenue = db.prepare('SELECT COALESCE(SUM(total_price), 0) as sum FROM orders').get().sum;
        const newOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'Новый'").get().count;

        return sendJson(200, {
          totalProducts,
          totalOrders,
          totalRevenue,
          newOrders
        });
      }

      // Список всех товаров (для админки)
      if (method === 'GET' && pathname === '/api/admin/products') {
        const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
        return sendJson(200, { products });
      }

      // Создать новый товар
      if (method === 'POST' && pathname === '/api/admin/products') {
        const { title, description, price, category, image_url, is_active } = await parseJsonBody(req);
        if (!title || price === undefined) {
          return sendError(400, 'Название и цена обязательны');
        }

        const stmt = db.prepare(`
          INSERT INTO products (title, description, price, category, image_url, is_active)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
          title.trim(),
          (description || '').trim(),
          parseFloat(price) || 0,
          (category || 'Общее').trim(),
          (image_url || '').trim(),
          is_active !== undefined ? (is_active ? 1 : 0) : 1
        );

        return sendJson(201, { success: true, id: Number(info.lastInsertRowid) });
      }

      // Обновить товар
      if (method === 'PUT' && pathname.startsWith('/api/admin/products/')) {
        const id = parseInt(pathname.split('/')[4], 10);
        const { title, description, price, category, image_url, is_active } = await parseJsonBody(req);

        const stmt = db.prepare(`
          UPDATE products
          SET title = ?, description = ?, price = ?, category = ?, image_url = ?, is_active = ?
          WHERE id = ?
        `);
        stmt.run(
          title.trim(),
          (description || '').trim(),
          parseFloat(price) || 0,
          (category || 'Общее').trim(),
          (image_url || '').trim(),
          is_active ? 1 : 0,
          id
        );

        return sendJson(200, { success: true });
      }

      // Удалить товар
      if (method === 'DELETE' && pathname.startsWith('/api/admin/products/')) {
        const id = parseInt(pathname.split('/')[4], 10);
        db.prepare('DELETE FROM products WHERE id = ?').run(id);
        return sendJson(200, { success: true });
      }

      // Список всех заказов
      if (method === 'GET' && pathname === '/api/admin/orders') {
        const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
        const ordersFormatted = orders.map(o => {
          let items = [];
          try {
            items = JSON.parse(o.items_json);
          } catch (e) {}
          return { ...o, items };
        });
        return sendJson(200, { orders: ordersFormatted });
      }

      // Изменить статус заказа
      if (method === 'PATCH' && pathname.startsWith('/api/admin/orders/')) {
        const id = parseInt(pathname.split('/')[4], 10);
        const { status } = await parseJsonBody(req);
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
        return sendJson(200, { success: true });
      }

      // Получить настройки (Telegram, пароль, etc.)
      if (method === 'GET' && pathname === '/api/admin/settings') {
        return sendJson(200, {
          telegram_bot_token: getSetting('telegram_bot_token', ''),
          telegram_chat_id: getSetting('telegram_chat_id', ''),
          app_url: getSetting('app_url', ''),
          age_gate_enabled: getSetting('age_gate_enabled', 'true') === 'true'
        });
      }

      // Сохранить настройки
      if (method === 'POST' && pathname === '/api/admin/settings') {
        const { telegram_bot_token, telegram_chat_id, app_url, age_gate_enabled, new_password } = await parseJsonBody(req);

        if (telegram_bot_token !== undefined) setSetting('telegram_bot_token', telegram_bot_token.trim());
        if (telegram_chat_id !== undefined) setSetting('telegram_chat_id', telegram_chat_id.trim());
        if (app_url !== undefined) setSetting('app_url', app_url.trim());
        if (age_gate_enabled !== undefined) setSetting('age_gate_enabled', age_gate_enabled ? 'true' : 'false');
        if (new_password && new_password.trim().length >= 4) {
          setSetting('admin_password', new_password.trim());
        }

        // Обновляем кнопку меню в Telegram-боте, если указан URL и токен
        const currentToken = getSetting('telegram_bot_token', '');
        const currentAppUrl = getSetting('app_url', '');
        if (currentToken) {
          updateTelegramMenuButton(currentToken, currentAppUrl).catch(() => {});
        }

        return sendJson(200, { success: true, message: 'Настройки успешно сохранены' });
      }

      // Тестовая отправка сообщения в Telegram
      if (method === 'POST' && pathname === '/api/admin/test-telegram') {
        const testText = `🤖 <b>Тестовое уведомление из интернет-магазина!</b>\n\nИнтеграция с Telegram-ботом работает корректно ✅\n🕒 Время отправки: ${new Date().toLocaleString('ru-RU')}`;
        const result = await sendTelegramMessage(testText);
        if (result.success) {
          return sendJson(200, { success: true, message: 'Тестовое сообщение успешно отправлено!' });
        } else {
          return sendError(400, result.reason || 'Ошибка при отправке');
        }
      }

      // Загрузка фото товара (base64 JSON)
      if (method === 'POST' && pathname === '/api/admin/upload') {
        const { filename, base64Data } = await parseJsonBody(req);
        if (!base64Data) return sendError(400, 'Отсутствуют данные изображения');

        // Отделяем мета-заголовок (data:image/jpeg;base64,...)
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        let buffer;
        let ext = '.jpg';

        if (matches && matches.length === 3) {
          const mime = matches[1];
          if (mime.includes('png')) ext = '.png';
          else if (mime.includes('webp')) ext = '.webp';
          else if (mime.includes('gif')) ext = '.gif';
          buffer = Buffer.from(matches[2], 'base64');
        } else {
          buffer = Buffer.from(base64Data, 'base64');
        }

        const safeFilename = `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
        const targetPath = path.join(UPLOADS_DIR, safeFilename);

        fs.writeFileSync(targetPath, buffer);
        return sendJson(200, {
          success: true,
          url: `/uploads/${safeFilename}`
        });
      }

      return sendError(404, 'Endpoint админки не найден');
    }

    // ==========================================
    // СТАТИЧЕСКИЕ ФАЙЛЫ
    // ==========================================

    let filePath;
    if (pathname === '/' || pathname === '/index.html') {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    } else if (pathname === '/admin' || pathname === '/admin.html') {
      filePath = path.join(PUBLIC_DIR, 'admin.html');
    } else if (pathname.startsWith('/uploads/')) {
      filePath = path.join(UPLOADS_DIR, path.basename(pathname));
    } else {
      filePath = path.join(PUBLIC_DIR, pathname);
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      return fs.createReadStream(filePath).pipe(res);
    }

    // 404
    sendError(404, 'Страница не найдена');
  } catch (error) {
    console.error('[Server Error]', error);
    sendError(500, 'Внутренняя ошибка сервера: ' + error.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛒 Сайт-каталог товаров запущен и доступен:`);
  console.log(`👉 Витрина магазина:     http://localhost:${PORT}`);
  console.log(`⚙️ Админ-панель:          http://localhost:${PORT}/admin`);
  console.log(`🔑 Пароль админа по умолч.: admin123`);
  console.log(`======================================================\n`);
});
