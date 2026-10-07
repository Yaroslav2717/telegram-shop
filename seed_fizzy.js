const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const db = new DatabaseSync(path.join(__dirname, 'database.db'));

// Добавляем колонку flavors, если её нет
try {
  db.exec('ALTER TABLE products ADD COLUMN flavors TEXT;');
  console.log('Колонка flavors добавлена в таблицу products.');
} catch (e) {
  // Колонка уже существует
}

// Удаляем старые тестовые товары (не относящиеся к Fizzy)
db.exec(`
  DELETE FROM products WHERE title LIKE '%Noir%' OR title LIKE '%Aero%' OR title LIKE '%Gentleman%' OR title LIKE '%Titan%' OR title LIKE '%Glencairn%' OR title LIKE '%Havana%' OR title LIKE '%15в1%';
`);

const fizzyProducts = [
  {
    title: 'Fizzy Smart 150K (15 in 1)',
    description: 'Флагманский электронный испаритель Fizzy Smart на рекордные 150 000 затяжек. Концепция 15 вкусов в 1, умный дисплей с индикацией заряда и жидкости, регулировка затяжки, крепость 5%.',
    price: 115,
    category: 'Fizzy 150K',
    image_url: '/uploads/fizzy_smart_150k.png',
    flavors: JSON.stringify([
      'Strawberry Kiwi, Mixed Berry, Watermelon Bubblegum, Juicy Peach',
      'Love 66, Strawberry Kiwi, Watermelon Blueberry, Black Ice Dragon Fruit Strawberry'
    ]),
    is_active: 1
  },
  {
    title: 'Fizzy Prime Max 80K',
    description: 'Яркая электронная сигарета Fizzy Prime Max на 80 000 затяжек с двойной сетчатой катушкой (Dual Mesh), анимационным экраном и насыщенной вкусопередачей. Крепость 5%.',
    price: 80,
    category: 'Fizzy 80K',
    image_url: '/uploads/fizzy_prime_max_80k.png',
    flavors: JSON.stringify([
      'Cola Ice',
      'Blueberry Raspberry Ice'
    ]),
    is_active: 1
  },
  {
    title: 'Fizzy Max III 120K (6 in 1)',
    description: 'Многофункциональный вейп Fizzy Max 3 с поворотной системой 6 в 1 и огромным ресурсом 120 000 затяжек. Быстрое переключение вкусов, информативный дисплей, зарядка Type-C, крепость 5%.',
    price: 100,
    category: 'Fizzy 120K',
    image_url: '/uploads/fizzy_max_3_120k.png',
    flavors: JSON.stringify([
      'Strawberry Dragon Fruit, Red Bull, Raspberry Watermelon',
      'Blueberry Raspberry, Triple Melon, Strawberry Ice'
    ]),
    is_active: 1
  },
  {
    title: 'Fizzy Twins 50K (Dual Tank)',
    description: 'Уникальное устройство Fizzy Twins на 50 000 затяжек с двойным баком: 2 независимых вкуса в одном корпусе с удобным переключателем. LED-индикатор, крепость 5%.',
    price: 70,
    category: 'Fizzy 50K',
    image_url: '/uploads/fizzy_twins_50k.png',
    flavors: JSON.stringify([
      'Blueberry Coconut + Grape Ice',
      'Raspberry Watermelon + Kiwi Passion Fruit Guava'
    ]),
    is_active: 1
  },
  {
    title: 'Fizzy X-Space 100K',
    description: 'Футуристический вейп Fizzy X-Space на 100 000 затяжек с космическим дизайном, анимационным цветным экраном и мощным двойным койлом для максимальной плотности пара. Крепость 5%.',
    price: 95,
    category: 'Fizzy 100K',
    image_url: '/uploads/fizzy_xspace_100k.png',
    flavors: JSON.stringify([
      'Strawberry Banana',
      'Monster Mango'
    ]),
    is_active: 1
  }
];

const insertStmt = db.prepare(`
  INSERT INTO products (title, description, price, category, image_url, flavors, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

for (const p of fizzyProducts) {
  insertStmt.run(p.title, p.description, p.price, p.category, p.image_url, p.flavors, p.is_active);
}

console.log('Успешно добавлено ' + fizzyProducts.length + ' товаров Fizzy с фото, ценами и вкусами!');
const all = db.prepare('SELECT id, title, price, category, flavors FROM products').all();
console.log(all);
