const express = require('express');
const bcrypt = require('bcrypt');
const axios = require('axios');
require('dotenv').config();

const db = require('./db');
const { getAuthUser } = require('./utils');

const app = express();
app.use(express.json());

// 1. Register
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash]);
    res.status(201).json({ message: 'User registered' });
  } catch (err) {
    res.status(400).json({ error: 'User exists or invalid input' });
  }
});

// 2. Fund Account
app.post('/fund', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const amt = req.body.amt;
  const newBal = user.balance + amt;

  await db.query('UPDATE users SET balance = ? WHERE username = ?', [newBal, user.username]);
  await db.query('INSERT INTO transactions (username, kind, amt, updated_bal) VALUES (?, "credit", ?, ?)', [user.username, amt, newBal]);

  res.json({ balance: newBal });
});

// 3. Pay Another User
app.post('/pay', async (req, res) => {
  const sender = await getAuthUser(req);
  if (!sender) return res.status(401).json({ error: 'Unauthorized' });

  const { to, amt } = req.body;
  if (sender.balance < amt) return res.status(400).json({ error: 'Insufficient funds' });

  const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [to]);
  if (rows.length === 0) return res.status(400).json({ error: 'Recipient not found' });

  const receiver = rows[0];
  const senderNewBal = sender.balance - amt;
  const receiverNewBal = receiver.balance + amt;

  await db.query('UPDATE users SET balance = ? WHERE username = ?', [senderNewBal, sender.username]);
  await db.query('UPDATE users SET balance = ? WHERE username = ?', [receiverNewBal, receiver.username]);

  await db.query('INSERT INTO transactions (username, kind, amt, updated_bal) VALUES (?, "debit", ?, ?)', [sender.username, amt, senderNewBal]);
  await db.query('INSERT INTO transactions (username, kind, amt, updated_bal) VALUES (?, "credit", ?, ?)', [receiver.username, amt, receiverNewBal]);

  res.json({ balance: senderNewBal });
});

// 4. Check Balance API
app.get('/bal', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const inrBalance = user.balance;
  const currency = req.query.currency;

  if (!currency) {
    return res.json({ balance: inrBalance, currency: 'INR' });
  }

  try {
    const url = `https://api.currencyapi.com/v3/latest?apikey=${process.env.CURRENCY_API_KEY}&base_currency=INR&currencies=${currency}`;
    const response = await axios.get(url);
    const rate = response.data.data[currency]?.value;

    if (!rate) return res.status(400).json({ error: 'Invalid currency' });

    const converted = inrBalance * rate;
    res.json({ balance: Number(converted.toFixed(2)), currency });
  } catch (err) {
    res.status(500).json({ error: 'Currency conversion failed' });
  }
});

// 5. View Transaction History
app.get('/stmt', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const [rows] = await db.query(
    'SELECT kind, amt, updated_bal, timestamp FROM transactions WHERE username = ? ORDER BY timestamp DESC',
    [user.username]
  );
  res.json(rows);
});

// 6. Add Product
app.post('/product', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { name, price, description } = req.body;
  try {
    const [result] = await db.query('INSERT INTO products (name, price, description) VALUES (?, ?, ?)', [name, price, description]);
    res.status(201).json({ id: result.insertId, message: 'Product added' });
  } catch (err) {
    res.status(400).json({ error: 'Failed to add product' });
  }
});

// 7. List All Products
app.get('/product', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM products');
  res.json(rows);
});

// 8. Buy a Product
app.post('/buy', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { product_id } = req.body;
  const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [product_id]);

  if (rows.length === 0) return res.status(400).json({ error: 'Invalid product' });

  const product = rows[0];
  if (user.balance < product.price) return res.status(400).json({ error: 'Insufficient balance' });

  const newBal = user.balance - product.price;

  await db.query('UPDATE users SET balance = ? WHERE username = ?', [newBal, user.username]);
  await db.query('INSERT INTO transactions (username, kind, amt, updated_bal) VALUES (?, "debit", ?, ?)', [user.username, product.price, newBal]);

  res.json({ message: 'Product purchased', balance: newBal });
});

app.listen(3000, () => console.log('✅ Server running at http://localhost:3000'));
