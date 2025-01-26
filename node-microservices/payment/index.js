const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { v4: uuidv4 } = require('uuid');
const { PubSub } = require('@google-cloud/pubsub');

const app = express();
const PORT = 3003;
const TOPIC_NAME = "hotel";

// Singleton untuk koneksi database
class Database {
  static instance;

  static async getInstance() {
    if (!Database.instance) {
      Database.instance = await open({
        filename: './main.db', // Nama file database SQLite
        driver: sqlite3.Database,
      });
  
      // Buat tabel jika belum ada
      await Database.instance.exec(`
        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transactionId TEXT NOT NULL,
          bookingId TEXT NOT NULL,
          amount REAL NOT NULL,
          status TEXT NOT NULL
        )
      `);
  
      console.log('Koneksi database berhasil.');
    }
    return Database.instance;
  }
}

// Singleton untuk koneksi Google PubSub
class PubSubClient {
  static instance;

  static getInstance() {
    if (!PubSubClient.instance) {
      PubSubClient.instance = new PubSub({
        keyFilename: './../broker-key.json', // credential akun google
      });
    }
    return PubSubClient.instance;
  }
}

app.use(bodyParser.json());

app.use(
  cors({
    origin: 'https://binus-sd-group1.github.io',
    credentials: true,
  })
);

// Fungsi untuk mempublikasikan event ke Google Pub/Sub
async function publishEvent(message) {
  try {
    const dataBuffer = Buffer.from(JSON.stringify(message));
    await PubSubClient.getInstance().topic(TOPIC_NAME).publishMessage({ data: dataBuffer });
    console.log(`Event published to topic ${TOPIC_NAME}:`, message);
  } catch (error) {
    console.error('Failed to publish event:', error);
  }
}

// Process a payment
app.post('/add', async (req, res) => {
  const { bookingId, amount } = req.body;

  if (!bookingId || amount === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const transactionId = uuidv4();

  try {
    const db = await Database.getInstance();

    // Simpan data pembayaran ke database
    await db.run(
      'INSERT INTO payments (transactionId, bookingId, amount, status) VALUES (?, ?, ?, ?)',
      [transactionId, bookingId, amount, 'successful']
    );

    // Publikasikan event ke Google Pub/Sub
    const eventData = { type: 'payment', transactionId, bookingId, amount, status: 'paid' };
    await publishEvent(eventData);

    res.json({ transactionId });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// Get all payments
app.get('/list', async (req, res) => {
  try {
    const db = await Database.getInstance();
    const payments = await db.all('SELECT * FROM payments');
    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Initialize and start server
(async () => {
  try {
    await Database.getInstance(); // Ensure database is initialized
    app.listen(PORT, () => {
      console.log(`Payment Service running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
  }
})();
