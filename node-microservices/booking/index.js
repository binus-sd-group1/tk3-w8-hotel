const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { v4: uuidv4 } = require('uuid');
const { PubSub } = require('@google-cloud/pubsub');

const app = express();
const PORT = 3002;
const TOPIC_NAME = "hotel";
const SUB_NAME = "payment-sub";

// Singleton for Database Connection
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
        CREATE TABLE IF NOT EXISTS bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bookingId TEXT NOT NULL,
          roomId TEXT NOT NULL,
          customerName TEXT NOT NULL,
          status TEXT NOT NULL
        )
      `);

      console.log('Connected to SQLite database and ensured table exists.');
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

// Fungsi untuk subscribe google pub/sub
async function subscribeToMessages() {
  const pubSubClient = PubSubClient.getInstance();
  const subscription = pubSubClient.subscription(SUB_NAME);

  subscription.on('message', async (message) => {
    try {
      const db = await Database.getInstance();
      const eventData = JSON.parse(message.data.toString());
      
      if(eventData["type"] == "payment"){
        console.log('Received payment event:', eventData);
        // Update status pembayaran
        const { bookingId } = eventData;
        await db.run('UPDATE bookings SET status = ? WHERE bookingId = ?', ['paid', bookingId]);
        console.log(`Payment status of ${bookingId} is updated`);
      }
      message.ack();
    } catch (error) {
      console.error('Failed to process message:', error);
    }
  });

  subscription.on('error', (error) => {
    console.error('Subscription error:', error);
  });
}


// Fungsi untuk mempublikasikan event ke Google Pub/Sub
async function publishEvent(message) {
  try {
    const dataBuffer = Buffer.from(JSON.stringify(message));
    const pubSub = PubSubClient.getInstance();
    await pubSub.topic(TOPIC_NAME).publishMessage({ data: dataBuffer });
    console.log(`Event published to topic ${TOPIC_NAME}:`, message);
  } catch (error) {
    console.error('Failed to publish event:', error);
  }
}

// Create a new booking
app.post('/add', async (req, res) => {
  const { roomId, customerName } = req.body;

  if (!roomId || !customerName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const bookingId = uuidv4();

  try {
    const db = await Database.getInstance();

    // Simpan data booking ke database
    await db.run(
      'INSERT INTO bookings (bookingId, roomId, customerName, status) VALUES (?, ?, ?, ?)',
      [bookingId, roomId, customerName, 'confirmed']
    );

    // Publikasikan event ke Google Pub/Sub
    const bookingEvent = { type: 'book', bookingId, roomId, customerName, status: 'confirmed' };
    await publishEvent(bookingEvent);

    res.json({ bookingId });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Get all bookings
app.get('/list', async (req, res) => {
  try {
    const db = await Database.getInstance();
    const bookings = await db.all('SELECT * FROM bookings');
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Initialize and start server
(async () => {
  try {
    await Database.getInstance(); // Ensure database is initialized
    app.listen(PORT, () => {
      console.log(`Booking Service running on http://localhost:${PORT}`);
    });

    // Listen event dari broker
    subscribeToMessages();
  } catch (error) {
    console.error('Failed to initialize application:', error);
  }
})();
