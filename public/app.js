/**
 * Клиентская логика витрины магазина:
 * - Age-Gate (Проверка 18+)
 * - Загрузка и фильтрация каталога
 * - Корзина (с сохранением в LocalStorage)
 * - Оформление заказа и отправка в Telegram через API
 */

// Состояние приложения
const state = {
  products: [],
  categories: [],
  activeCategory: 'Все',
  searchQuery: '',
  cart: JSON.parse(localStorage.getItem('catalog_cart') || '[]'),
  selectedProductForModal: null
};

// ====================================================
// ИНИЦИАЛИЗАЦИЯ И AGE-GATE (ПРОВЕРКА ВОЗРАСТА 18+)
// ====================================================
document.addEventListener('DOMContentLoaded', () => {
  initTelegramWebApp();
  initAgeGate();
  initCartUI();
  initEventListeners();
  loadProducts();
});

function initTelegramWebApp() {
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    try {
      tg.ready();
      tg.expand(); // Развернуть окно на весь экран внутри Telegram
    } catch (e) {
      console.log('Telegram WebApp initialized');
    }

    // Автоматическое заполнение данных пользователя Telegram в форму заказа
    const user = tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (user) {
      const nameInput = document.getElementById('custName');
      const phoneInput = document.getElementById('custPhone');
      if (nameInput) {
        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
        if (fullName) nameInput.value = fullName;
      }
      if (phoneInput && user.username) {
        phoneInput.value = `@${user.username}`;
      }
    }
  }
}

function initAgeGate() {
  const overlay = document.getElementById('ageGateOverlay');
  const promptBox = document.getElementById('agePromptBox');
  const blockedBox = document.getElementById('ageBlockedBox');
  const btnYes = document.getElementById('btnAgeYes');
  const btnNo = document.getElementById('btnAgeNo');
  const btnRetry = document.getElementById('btnAgeRetry');
  const btnReset = document.getElementById('resetAgeBtn');

  const isVerified = localStorage.getItem('age_verified_18_catalog');

  if (isVerified === 'yes') {
    overlay.style.display = 'none';
  } else {
    overlay.style.display = 'flex';
    promptBox.classList.remove('hidden');
    blockedBox.classList.remove('active');
  }

  // Клик "Да, мне есть 18 лет"
  btnYes.addEventListener('click', () => {
    localStorage.setItem('age_verified_18_catalog', 'yes');
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
      showToast('Доступ к каталогу открыт (18+)', 'success');
    }, 300);
  });

  // Клик "Нет, мне меньше 18"
  btnNo.addEventListener('click', () => {
    promptBox.classList.add('hidden');
    blockedBox.classList.add('active');
  });

  // Клик "Я нажал случайно"
  btnRetry.addEventListener('click', () => {
    blockedBox.classList.remove('active');
    promptBox.classList.remove('hidden');
  });

  // Сброс подтверждения (для тестирования)
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      localStorage.removeItem('age_verified_18_catalog');
      promptBox.classList.remove('hidden');
      blockedBox.classList.remove('active');
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
      showToast('Статус возраста сброшен. Проверка активирована.', 'info');
    });
  }
}

// ====================================================
// ЗАГРУЗКА И ОТОБРАЖЕНИЕ КАТАЛОГА ТОВАРОВ
// ====================================================
async function loadProducts() {
  const grid = document.getElementById('catalogGrid');
  grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">Загрузка товаров каталога...</div>';

  try {
    let url = '/api/products?';
    if (state.activeCategory && state.activeCategory !== 'Все') {
      url += `category=${encodeURIComponent(state.activeCategory)}&`;
    }
    if (state.searchQuery) {
      url += `search=${encodeURIComponent(state.searchQuery)}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    state.products = data.products || [];
    state.categories = data.categories || ['Все'];

    renderCategoriesBar();
    renderProductGrid();
  } catch (err) {
    console.error('Ошибка загрузки каталога:', err);
    grid.innerHTML = '<div class="empty-catalog"><h3>Не удалось загрузить товары</h3><p>Проверьте соединение с сервером.</p></div>';
  }
}

function renderCategoriesBar() {
  const bar = document.getElementById('categoriesBar');
  bar.innerHTML = '';

  state.categories.forEach(cat => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `cat-chip ${cat === state.activeCategory ? 'active' : ''}`;
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      state.activeCategory = cat;
      loadProducts();
    });
    bar.appendChild(chip);
  });
}

function renderProductGrid() {
  const grid = document.getElementById('catalogGrid');
  grid.innerHTML = '';

  if (state.products.length === 0) {
    grid.innerHTML = `
      <div class="empty-catalog">
        <h3>Товары не найдены</h3>
        <p>По вашему запросу ничего не найдено. Попробуйте изменить параметры поиска или категорию.</p>
      </div>
    `;
    return;
  }

  state.products.forEach(prod => {
    const card = document.createElement('article');
    card.className = 'product-card';

    const fallbackImg = 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=800&q=80';
    const imageUrl = prod.image_url || fallbackImg;

    card.innerHTML = `
      <div class="product-image-wrap" data-id="${prod.id}">
        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(prod.title)}" loading="lazy">
        <span class="product-cat-tag">${escapeHtml(prod.category || 'Товар')}</span>
      </div>
      <div class="product-info">
        <h3 class="product-title" data-id="${prod.id}">${escapeHtml(prod.title)}</h3>
        <p class="product-description">${escapeHtml(prod.description || '')}</p>
        <div class="product-bottom">
          <div class="product-price">${prod.price.toLocaleString('pl-PL')} <span>zł</span></div>
          <button class="add-cart-btn" data-id="${prod.id}" type="button">
            🛒 В корзину
          </button>
        </div>
      </div>
    `;

    // Клик на картинку или название открывает детальное окно
    const openModalElements = card.querySelectorAll('[data-id]');
    openModalElements.forEach(el => {
      if (!el.classList.contains('add-cart-btn')) {
        el.addEventListener('click', () => openProductModal(prod));
      }
    });

    // Кнопка добавления в корзину
    const addBtn = card.querySelector('.add-cart-btn');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToCart(prod);
      addBtn.classList.add('added');
      addBtn.textContent = '✓ В корзине';
      setTimeout(() => {
        addBtn.classList.remove('added');
        addBtn.innerHTML = '🛒 В корзину';
      }, 1000);
    });

    grid.appendChild(card);
  });
}

// ====================================================
// МОДАЛЬНОЕ ОКНО ДЕТАЛЕЙ ТОВАРА
// ====================================================
function openProductModal(product) {
  state.selectedProductForModal = product;
  const overlay = document.getElementById('productModalOverlay');
  const img = document.getElementById('modalProdImage');
  const cat = document.getElementById('modalProdCategory');
  const title = document.getElementById('modalProdTitle');
  const desc = document.getElementById('modalProdDesc');
  const price = document.getElementById('modalProdPrice');

  img.src = product.image_url || 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=800&q=80';
  img.alt = product.title;
  cat.textContent = product.category || 'Товар';
  title.textContent = product.title;
  desc.textContent = product.description || 'Описание отсутствует.';
  price.textContent = `${product.price.toLocaleString('pl-PL')} zł`;

  overlay.classList.add('open');
}

function closeProductModal() {
  document.getElementById('productModalOverlay').classList.remove('open');
}

// ====================================================
// ЛОГИКА КОРЗИНЫ
// ====================================================
function addToCart(product) {
  const existing = state.cart.find(i => i.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({
      id: product.id,
      title: product.title,
      price: product.price,
      image_url: product.image_url,
      quantity: 1
    });
  }
  saveCart();
  renderCart();
  showToast(`«${product.title}» добавлен в корзину!`, 'success');
}

function updateCartQuantity(id, delta) {
  const item = state.cart.find(i => i.id === id);
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) {
    state.cart = state.cart.filter(i => i.id !== id);
  }
  saveCart();
  renderCart();
}

function removeFromCart(id) {
  state.cart = state.cart.filter(i => i.id !== id);
  saveCart();
  renderCart();
  showToast('Товар удален из корзины', 'info');
}

function saveCart() {
  localStorage.setItem('catalog_cart', JSON.stringify(state.cart));
}

function initCartUI() {
  renderCart();
}

function renderCart() {
  const badge = document.getElementById('cartCountBadge');
  const itemsContainer = document.getElementById('cartItemsList');
  const totalElem = document.getElementById('cartTotalSum');
  const checkoutTotalElem = document.getElementById('checkoutTotalSum');

  const totalCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  badge.textContent = totalCount;
  totalElem.textContent = `${totalPrice.toLocaleString('pl-PL')} zł`;
  if (checkoutTotalElem) {
    checkoutTotalElem.textContent = `${totalPrice.toLocaleString('pl-PL')} zł`;
  }

  if (state.cart.length === 0) {
    itemsContainer.innerHTML = `
      <div class="cart-empty-message">
        <div style="font-size: 40px; margin-bottom: 10px;">🛒</div>
        Ваша корзина пуста.<br>Выберите понравившиеся товары из каталога.
      </div>
    `;
    return;
  }

  itemsContainer.innerHTML = '';
  state.cart.forEach(item => {
    const el = document.createElement('div');
    el.className = 'cart-item';
    const fallback = 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=400&q=80';
    const imgUrl = item.image_url || fallback;

    el.innerHTML = `
      <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(item.title)}" class="cart-item-img">
      <div class="cart-item-details">
        <div class="cart-item-title">${escapeHtml(item.title)}</div>
        <div class="cart-item-price">${(item.price * item.quantity).toLocaleString('pl-PL')} zł</div>
        <div class="cart-item-controls">
          <button class="qty-btn" type="button" data-action="minus" data-id="${item.id}">−</button>
          <span class="qty-val">${item.quantity}</span>
          <button class="qty-btn" type="button" data-action="plus" data-id="${item.id}">+</button>
        </div>
      </div>
      <button class="cart-item-remove" type="button" data-id="${item.id}" title="Удалить">🗑️</button>
    `;

    el.querySelector('[data-action="minus"]').addEventListener('click', () => updateCartQuantity(item.id, -1));
    el.querySelector('[data-action="plus"]').addEventListener('click', () => updateCartQuantity(item.id, 1));
    el.querySelector('.cart-item-remove').addEventListener('click', () => removeFromCart(item.id));

    itemsContainer.appendChild(el);
  });
}

// Открытие и закрытие боковой корзины
function openCart() {
  document.getElementById('cartDrawerOverlay').classList.add('open');
  document.getElementById('cartDrawer').classList.add('open');
}

function closeCart() {
  document.getElementById('cartDrawerOverlay').classList.remove('open');
  document.getElementById('cartDrawer').classList.remove('open');
}

// ====================================================
// ОФОРМЛЕНИЕ ЗАКАЗА И ОТПРАВКА В TELEGRAM
// ====================================================
function openCheckoutModal() {
  if (state.cart.length === 0) {
    showToast('Сначала добавьте товары в корзину', 'error');
    return;
  }
  closeCart();
  document.getElementById('checkoutModalOverlay').classList.add('open');
}

function closeCheckoutModal() {
  document.getElementById('checkoutModalOverlay').classList.remove('open');
}

async function handleCheckoutSubmit(e) {
  e.preventDefault();

  const btn = document.getElementById('submitOrderBtn');
  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const comment = document.getElementById('custComment').value.trim();

  if (!name || !phone) {
    showToast('Пожалуйста, заполните имя и контактный телефон', 'error');
    return;
  }

  if (state.cart.length === 0) {
    showToast('Корзина пуста', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Оформляем заказ...';

  try {
    const payload = {
      customer_name: name,
      customer_phone: phone,
      customer_comment: comment,
      items: state.cart.map(i => ({ id: i.id, quantity: i.quantity }))
    };

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Ошибка при сохранении заказа');
    }

    // Заказ успешно создан
    closeCheckoutModal();
    document.getElementById('checkoutForm').reset();

    // Очищаем корзину
    state.cart = [];
    saveCart();
    renderCart();

    // Открываем модалку успеха
    const successModal = document.getElementById('orderSuccessModal');
    const orderIdElem = document.getElementById('successOrderId');
    const tgStatusElem = document.getElementById('successTelegramStatus');

    orderIdElem.textContent = `#${data.orderId}`;

    if (data.telegramNotified) {
      tgStatusElem.innerHTML = '✈️ Детали заказа моментально переданы в <b>Telegram-бот</b>!';
      tgStatusElem.style.color = 'var(--success)';
    } else {
      tgStatusElem.innerHTML = `ℹ️ Заказ принят в систему! (${data.telegramMessage})`;
      tgStatusElem.style.color = 'var(--text-muted)';
    }

    successModal.classList.add('open');
  } catch (err) {
    console.error('Ошибка заказа:', err);
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Подтвердить и отправить заказ';
  }
}

// ====================================================
// ОБЩИЕ СЛУШАТЕЛИ СОБЫТИЙ
// ====================================================
function initEventListeners() {
  // Корзина
  document.getElementById('cartOpenBtn').addEventListener('click', openCart);
  document.getElementById('cartCloseBtn').addEventListener('click', closeCart);
  document.getElementById('cartDrawerOverlay').addEventListener('click', closeCart);

  // Оформление заказа
  document.getElementById('openCheckoutModalBtn').addEventListener('click', openCheckoutModal);
  document.getElementById('closeCheckoutModalBtn').addEventListener('click', closeCheckoutModal);
  document.getElementById('checkoutModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'checkoutModalOverlay') closeCheckoutModal();
  });
  document.getElementById('checkoutForm').addEventListener('submit', handleCheckoutSubmit);

  // Модалка товара
  document.getElementById('closeProductModalBtn').addEventListener('click', closeProductModal);
  document.getElementById('productModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'productModalOverlay') closeProductModal();
  });
  document.getElementById('modalAddToCartBtn').addEventListener('click', () => {
    if (state.selectedProductForModal) {
      addToCart(state.selectedProductForModal);
      closeProductModal();
    }
  });

  // Модалка успешного заказа
  document.getElementById('successOkBtn').addEventListener('click', () => {
    document.getElementById('orderSuccessModal').classList.remove('open');
  });

  // Поиск по каталогу (с задержкой)
  let searchTimeout;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      loadProducts();
    }, 300);
  });
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
