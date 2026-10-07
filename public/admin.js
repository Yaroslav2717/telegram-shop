/**
 * Логика административной панели:
 * - Авторизация
 * - Управление товарами (CRUD + загрузка фото)
 * - Управление заказами (просмотр и смена статусов)
 * - Настройка Telegram-бота и тестовая отправка сообщений
 */

const adminState = {
  token: localStorage.getItem('admin_token') || '',
  products: [],
  orders: [],
  ordersPeriod: 'all',
  currentTab: 'products'
};

// Заголовки для авторизованных запросов
function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-admin-token': adminState.token
  };
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  initTabs();
  initProductForm();
  initSettingsForm();
  initOrdersView();
});

// ====================================================
// АВТОРИЗАЦИЯ АДМИНИСТРАТОРА
// ====================================================
async function checkAuth() {
  if (!adminState.token) {
    showLoginView();
    return;
  }

  try {
    const res = await fetch('/api/admin/check', {
      headers: { 'x-admin-token': adminState.token }
    });
    const data = await res.json();

    if (data.authenticated) {
      showDashboardView();
      loadDashboardData();
    } else {
      showLoginView();
    }
  } catch (err) {
    showLoginView();
  }
}

function showLoginView() {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('dashboardView').classList.add('hidden');
}

function showDashboardView() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('dashboardView').classList.remove('hidden');
}

// Форма входа
document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('adminPasswordInput').value;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Неверный пароль');
    }

    adminState.token = data.token;
    localStorage.setItem('admin_token', data.token);
    showToast('Успешный вход в панель управления', 'success');
    showDashboardView();
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Кнопка выхода
document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  try {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: getAuthHeaders()
    });
  } catch (e) {}

  adminState.token = '';
  localStorage.removeItem('admin_token');
  showLoginView();
  showToast('Вы вышли из системы', 'info');
});

// ====================================================
// ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК И СТАТИСТИКА
// ====================================================
function initTabs() {
  const tabButtons = document.querySelectorAll('.admin-tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.add('hidden'));
      document.getElementById(`tab-${targetTab}`).classList.remove('hidden');
      adminState.currentTab = targetTab;

      if (targetTab === 'products') loadProducts();
      if (targetTab === 'orders') loadOrders();
      if (targetTab === 'settings') loadSettings();
    });
  });
}

async function loadDashboardData() {
  loadStats();
  loadProducts();
  loadOrders();
}

async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const stats = await res.json();

    document.getElementById('statProducts').textContent = stats.totalProducts;
    document.getElementById('statOrders').textContent = stats.totalOrders;
    document.getElementById('statRevenue').textContent = `${(stats.totalRevenue || 0).toLocaleString('pl-PL')} zł`;
    document.getElementById('statNewOrders').textContent = stats.newOrders;

    // Разбивка по периодам
    const revBreakdown = document.getElementById('statRevenueBreakdown');
    if (revBreakdown) {
      revBreakdown.textContent = `Сегодня: ${(stats.todayRevenue || 0).toLocaleString('pl-PL')} zł • Месяц: ${(stats.monthRevenue || 0).toLocaleString('pl-PL')} zł`;
    }

    const ordBreakdown = document.getElementById('statOrdersBreakdown');
    if (ordBreakdown) {
      ordBreakdown.textContent = `Сегодня: ${stats.todayOrders || 0} • Месяц: ${stats.monthOrders || 0}`;
    }

    const badge = document.getElementById('newOrdersBadge');
    if (stats.newOrders > 0) {
      badge.textContent = stats.newOrders;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    console.error('Ошибка загрузки статистики:', err);
  }
}

// ====================================================
// УПРАВЛЕНИЕ ТОВАРАМИ (CRUD)
// ====================================================
async function loadProducts() {
  const tbody = document.getElementById('adminProductsTableBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 24px;">Загрузка товаров...</td></tr>';

  try {
    const res = await fetch('/api/admin/products', { headers: getAuthHeaders() });
    const data = await res.json();
    adminState.products = data.products || [];
    renderProductsTable(adminState.products);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: #ef4444; padding: 24px;">Ошибка загрузки товаров</td></tr>';
  }
}

function renderProductsTable(products) {
  const tbody = document.getElementById('adminProductsTableBody');
  tbody.innerHTML = '';

  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 30px; color: var(--admin-muted);">В каталоге пока нет товаров. Добавьте первый товар!</td></tr>';
    return;
  }

  products.forEach(p => {
    const tr = document.createElement('tr');
    const fallback = 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=200&q=80';
    const imgUrl = p.image_url || fallback;

    let flavorsSummary = '';
    if (p.flavors) {
      try {
        const flList = typeof p.flavors === 'string' ? JSON.parse(p.flavors) : p.flavors;
        if (Array.isArray(flList) && flList.length > 0) {
          flavorsSummary = `<div style="font-size: 11px; color: #38bdf8; margin-top: 3px;">🍓 Вкусов: ${flList.length} (${escapeHtml(flList.slice(0, 2).join(', '))}${flList.length > 2 ? '...' : ''})</div>`;
        }
      } catch (e) {}
    }

    tr.innerHTML = `
      <td><img src="${escapeHtml(imgUrl)}" alt="" class="table-thumb"></td>
      <td>
        <div style="font-weight: 700; color: var(--admin-text);">${escapeHtml(p.title)}</div>
        <div style="font-size: 12px; color: var(--admin-muted);">${escapeHtml((p.description || '').substring(0, 60))}...</div>
        ${flavorsSummary}
      </td>
      <td><span class="badge" style="background: rgba(255,255,255,0.06);">${escapeHtml(p.category || 'Общее')}</span></td>
      <td style="font-weight: 700;">${p.price.toLocaleString('pl-PL')} zł</td>
      <td>
        <span class="badge ${p.is_active ? 'badge-done' : 'badge-cancel'}">
          ${p.is_active ? 'Активен' : 'Скрыт'}
        </span>
      </td>
      <td style="text-align: right;">
        <button class="btn-secondary edit-prod-btn" data-id="${p.id}" type="button" style="padding: 6px 10px;" title="Редактировать">✏️</button>
        <button class="btn-danger del-prod-btn" data-id="${p.id}" type="button" style="padding: 6px 10px;" title="Удалить">🗑️</button>
      </td>
    `;

    tr.querySelector('.edit-prod-btn').addEventListener('click', () => openEditProductModal(p));
    tr.querySelector('.del-prod-btn').addEventListener('click', () => deleteProduct(p.id, p.title));

    tbody.appendChild(tr);
  });
}

// Поиск товаров в админке
document.getElementById('adminProductSearch').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  const filtered = adminState.products.filter(p =>
    p.title.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q))
  );
  renderProductsTable(filtered);
});

// Модальное окно создания / редактирования товара
function initProductForm() {
  const modal = document.getElementById('productModal');
  const form = document.getElementById('productForm');
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const preview = document.getElementById('imagePreview');
  const urlInput = document.getElementById('prodImageUrl');

  // Открыть окно добавления
  document.getElementById('openAddProductModalBtn').addEventListener('click', () => {
    form.reset();
    document.getElementById('prodFormId').value = '';
    document.getElementById('modalProductHeading').textContent = 'Добавление нового товара';
    document.getElementById('prodIsActive').checked = true;
    preview.classList.add('hidden');
    preview.src = '';
    modal.classList.add('open');
  });

  // Закрыть окно
  const closeModal = () => modal.classList.remove('open');
  document.getElementById('closeProductModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelProductBtn').addEventListener('click', closeModal);

  // Обработка загрузки картинки (Drag & Drop + FilePicker)
  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  async function handleFileSelected(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Выберите файл изображения (JPG, PNG, WEBP)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result;
      preview.src = base64Data;
      preview.classList.remove('hidden');

      // Отправляем на сервер в папку uploads/
      try {
        const res = await fetch('/api/admin/upload', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            filename: file.name,
            base64Data: base64Data
          })
        });
        const data = await res.json();
        if (data.success) {
          urlInput.value = data.url;
          showToast('Изображение успешно загружено на сервер', 'success');
        } else {
          showToast(data.error || 'Ошибка загрузки изображения', 'error');
        }
      } catch (err) {
        showToast('Не удалось загрузить изображение на сервер', 'error');
      }
    };
    reader.readAsDataURL(file);
  }

  // Обновление предпросмотра при вводе ссылки на картинку вручную
  urlInput.addEventListener('input', () => {
    if (urlInput.value.trim()) {
      preview.src = urlInput.value.trim();
      preview.classList.remove('hidden');
    }
  });

  // Отправка формы создания/редактирования
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('saveProductBtn');
    saveBtn.disabled = true;

    const id = document.getElementById('prodFormId').value;
    const rawFlavors = (document.getElementById('prodFlavors').value || '').trim();
    const flavorsArray = rawFlavors
      ? rawFlavors.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean)
      : [];

    const payload = {
      title: document.getElementById('prodTitle').value.trim(),
      category: document.getElementById('prodCategory').value.trim() || 'Общее',
      price: parseFloat(document.getElementById('prodPrice').value) || 0,
      description: document.getElementById('prodDescription').value.trim(),
      image_url: urlInput.value.trim(),
      flavors: flavorsArray,
      is_active: document.getElementById('prodIsActive').checked
    };

    try {
      let res;
      if (id) {
        // Редактирование
        res = await fetch(`/api/admin/products/${id}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
      } else {
        // Создание
        res = await fetch('/api/admin/products', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');

      showToast(id ? 'Товар успешно обновлен' : 'Новый товар успешно добавлен', 'success');
      closeModal();
      loadProducts();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function openEditProductModal(product) {
  const modal = document.getElementById('productModal');
  document.getElementById('modalProductHeading').textContent = `Редактирование: ${product.title}`;
  document.getElementById('prodFormId').value = product.id;
  document.getElementById('prodTitle').value = product.title;
  document.getElementById('prodCategory').value = product.category || '';
  document.getElementById('prodPrice').value = product.price;
  document.getElementById('prodDescription').value = product.description || '';
  document.getElementById('prodImageUrl').value = product.image_url || '';
  document.getElementById('prodIsActive').checked = product.is_active === 1;

  let flavorsText = '';
  if (product.flavors) {
    try {
      const parsed = typeof product.flavors === 'string' ? JSON.parse(product.flavors) : product.flavors;
      if (Array.isArray(parsed)) {
        flavorsText = parsed.join('\n');
      } else {
        flavorsText = String(product.flavors);
      }
    } catch (e) {
      flavorsText = String(product.flavors);
    }
  }
  document.getElementById('prodFlavors').value = flavorsText;

  const preview = document.getElementById('imagePreview');
  if (product.image_url) {
    preview.src = product.image_url;
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
    preview.src = '';
  }

  modal.classList.add('open');
}

async function deleteProduct(id, title) {
  if (!confirm(`Вы действительно хотите удалить товар «${title}»?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/products/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

    if (!res.ok) throw new Error('Не удалось удалить товар');

    showToast(`Товар «${title}» удален`, 'info');
    loadProducts();
    loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ====================================================
// УПРАВЛЕНИЕ ЗАКАЗАМИ И ИСТОРИЕЙ
// ====================================================
function initOrdersView() {
  // Кнопка обновления
  document.getElementById('refreshOrdersBtn').addEventListener('click', () => {
    loadOrders();
    loadStats();
    showToast('Список заказов обновлен', 'info');
  });

  // Фильтры истории по периодам (все время, сегодня, вчера, 7 дней, месяц)
  const periodChips = document.querySelectorAll('.order-period-chip');
  periodChips.forEach(chip => {
    chip.addEventListener('click', () => {
      periodChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      adminState.ordersPeriod = chip.getAttribute('data-period') || 'all';
      loadOrders();
    });
  });

  // Кнопка полной очистки заказов и обнуления баланса
  document.getElementById('clearAllOrdersBtn').addEventListener('click', async () => {
    const confirmed = confirm(
      '⚠️ ВНИМАНИЕ: Вы действительно хотите очистить ВСЕ заказы?\n\n' +
      '• Вся история заказов будет полностью удалена.\n' +
      '• Общий баланс проданных товаров обнулится до 0 zł.\n\n' +
      'Продолжить?'
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/admin/orders', {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Все заказы удалены, общий баланс продаж обнулен!', 'success');
        loadOrders();
        loadStats();
      } else {
        showToast(data.error || 'Ошибка очистки заказов', 'error');
      }
    } catch (err) {
      showToast('Ошибка при связи с сервером', 'error');
    }
  });
}

async function loadOrders() {
  const tbody = document.getElementById('adminOrdersTableBody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px;">Загрузка заказов...</td></tr>';

  try {
    const period = adminState.ordersPeriod || 'all';
    const res = await fetch(`/api/admin/orders?period=${encodeURIComponent(period)}`, { headers: getAuthHeaders() });
    const data = await res.json();
    adminState.orders = data.orders || [];
    renderOrdersTable(adminState.orders);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: #ef4444; padding: 24px;">Ошибка загрузки заказов</td></tr>';
  }
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('adminOrdersTableBody');
  tbody.innerHTML = '';

  if (orders.length === 0) {
    const periodNames = {
      all: 'за все время',
      today: 'за сегодня',
      yesterday: 'за вчера',
      week: 'за последние 7 дней',
      month: 'за этот месяц'
    };
    const periodText = periodNames[adminState.ordersPeriod] || '';
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px; color: var(--admin-muted);">Нет оформленных заказов ${periodText}.</td></tr>`;
    return;
  }

  orders.forEach(ord => {
    const tr = document.createElement('tr');
    const itemsListHtml = (ord.items || []).map(i =>
      `<div>• <b>${escapeHtml(i.title)}</b> (${i.quantity} шт. × ${i.price.toLocaleString('pl-PL')} zł)</div>`
    ).join('');

    const dateFormatted = new Date(ord.created_at).toLocaleString('pl-PL');

    tr.innerHTML = `
      <td><b>#${ord.id}</b></td>
      <td style="font-size: 12px; color: var(--admin-muted);">${dateFormatted}</td>
      <td>
        <div style="font-weight: 700;">${escapeHtml(ord.customer_name)}</div>
        <div style="font-size: 13px; color: var(--admin-primary);">${escapeHtml(ord.customer_phone)}</div>
        ${ord.customer_comment ? `<div style="font-size: 11px; color: var(--admin-muted); margin-top: 4px;">💬 ${escapeHtml(ord.customer_comment)}</div>` : ''}
      </td>
      <td style="font-size: 12px; max-width: 320px;">${itemsListHtml}</td>
      <td style="font-weight: 800; font-size: 15px; color: var(--admin-text);">${ord.total_price.toLocaleString('pl-PL')} zł</td>
      <td>
        <select class="order-status-select form-field" data-id="${ord.id}" style="padding: 6px 10px; font-size: 12px; margin-bottom: 0;">
          <option value="Новый" ${ord.status === 'Новый' ? 'selected' : ''}>🔵 Новый</option>
          <option value="В обработке" ${ord.status === 'В обработке' ? 'selected' : ''}>🟡 В обработке</option>
          <option value="Выполнен" ${ord.status === 'Выполнен' ? 'selected' : ''}>🟢 Выполнен</option>
          <option value="Отменен" ${ord.status === 'Отменен' ? 'selected' : ''}>🔴 Отменен</option>
        </select>
      </td>
      <td style="text-align: right;">
        <button class="btn-danger del-order-row-btn" data-id="${ord.id}" title="Удалить этот заказ" style="padding: 6px 10px;">🗑️</button>
      </td>
    `;

    // Слушатель смены статуса
    const select = tr.querySelector('.order-status-select');
    select.addEventListener('change', async () => {
      const newStatus = select.value;
      try {
        const res = await fetch(`/api/admin/orders/${ord.id}`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ status: newStatus })
        });
        if (res.ok) {
          showToast(`Статус заказа #${ord.id} изменен на «${newStatus}»`, 'success');
          loadStats();
        } else {
          showToast('Не удалось изменить статус', 'error');
        }
      } catch (e) {
        showToast('Ошибка сервера при смене статуса', 'error');
      }
    });

    // Слушатель удаления отдельного заказа
    const delBtn = tr.querySelector('.del-order-row-btn');
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Удалить заказ #${ord.id} от клиента ${ord.customer_name}?`)) {
        return;
      }
      try {
        const res = await fetch(`/api/admin/orders/${ord.id}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
        if (res.ok) {
          showToast(`Заказ #${ord.id} удален`, 'info');
          loadOrders();
          loadStats();
        } else {
          showToast('Не удалось удалить заказ', 'error');
        }
      } catch (err) {
        showToast('Ошибка при удалении заказа', 'error');
      }
    });

    tbody.appendChild(tr);
  });
}

// ====================================================
// НАСТРОЙКИ TELEGRAM-БОТА И ПАРОЛЯ
// ====================================================
function initSettingsForm() {
  // Сохранение настроек Telegram
  document.getElementById('telegramSettingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = document.getElementById('tgBotToken').value.trim();
    const chatId = document.getElementById('tgChatId').value.trim();
    const appUrl = document.getElementById('tgAppUrl').value.trim();

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          telegram_bot_token: token,
          telegram_chat_id: chatId,
          app_url: appUrl
        })
      });

      const data = await res.json();
      if (res.ok) {
        showToast('Настройки Telegram успешно сохранены', 'success');
      } else {
        showToast(data.error || 'Ошибка сохранения настроек', 'error');
      }
    } catch (err) {
      showToast('Ошибка при связи с сервером', 'error');
    }
  });

  // Тестовая отправка сообщения в Telegram
  document.getElementById('btnTestTelegram').addEventListener('click', async () => {
    const btn = document.getElementById('btnTestTelegram');
    btn.disabled = true;
    btn.textContent = 'Отправка...';

    // Сначала сохраняем значения из полей формы
    const token = document.getElementById('tgBotToken').value.trim();
    const chatId = document.getElementById('tgChatId').value.trim();
    const appUrl = document.getElementById('tgAppUrl').value.trim();

    try {
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          telegram_bot_token: token,
          telegram_chat_id: chatId,
          app_url: appUrl
        })
      });

      const res = await fetch('/api/admin/test-telegram', {
        method: 'POST',
        headers: getAuthHeaders()
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('🚀 Сообщение успешно доставлено в Telegram!', 'success');
      } else {
        showToast(`Ошибка: ${data.error || 'Проверьте токен и chat_id'}`, 'error');
      }
    } catch (err) {
      showToast('Не удалось отправить тестовое сообщение', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🚀 Отправить тестовое сообщение';
    }
  });

  // Сохранение пароля и Age-Gate
  document.getElementById('securitySettingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPass = document.getElementById('newAdminPassword').value.trim();
    const ageGate = document.getElementById('ageGateSettingCheckbox').checked;

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          new_password: newPass || undefined,
          age_gate_enabled: ageGate
        })
      });

      const data = await res.json();
      if (res.ok) {
        showToast('Параметры безопасности обновлены', 'success');
        document.getElementById('newAdminPassword').value = '';
      } else {
        showToast(data.error || 'Ошибка сохранения', 'error');
      }
    } catch (err) {
      showToast('Ошибка связи с сервером', 'error');
    }
  });
}

async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const settings = await res.json();

    document.getElementById('tgBotToken').value = settings.telegram_bot_token || '';
    document.getElementById('tgChatId').value = settings.telegram_chat_id || '';
    document.getElementById('tgAppUrl').value = settings.app_url || '';
    document.getElementById('ageGateSettingCheckbox').checked = settings.age_gate_enabled !== false;
  } catch (err) {
    console.error('Ошибка загрузки настроек:', err);
  }
}

// Всплывающие уведомления (Toast)
function showToast(text, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
    <span>${escapeHtml(text)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
