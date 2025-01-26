const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite'); 
const { PubSub } = require('@google-cloud/pubsub');

const app = express();
const PORT = 3001;
const SUB_NAME = "booking-sub";

app.use(cors({
  origin: 'https://binus-sd-group1.github.io',
  credentials: true,
}));

app.use(express.json());

// Singleton untuk koneksi database
class Database {
  static instance;

  static async getInstance() {
    if (!Database.instance) {
      Database.instance = await open({
        filename: './main.db',
        driver: sqlite3.Database,
      });

      // Ensure the rooms table exists
      await Database.instance.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_number TEXT NOT NULL,
          room_type TEXT NOT NULL,
          price REAL NOT NULL,
          availability BOOLEAN NOT NULL
        )
      `);

      // Add dummy data if the table is empty
      const count = await Database.instance.get('SELECT COUNT(*) as count FROM rooms');
      if (count.count === 0) {
        await Database.instance.exec(`
          INSERT INTO rooms (room_number, room_type, price, availability) VALUES
          ('101', 'Single', 100, true),
          ('102', 'Double', 150, true),
          ('103', 'Suite', 250, true),
          ('104', 'Single', 120, true),
          ('105', 'Deluxe', 300, true),
          ('106', 'Single', 110, true),
          ('107', 'Double', 160, true),
          ('108', 'Suite', 270, true),
          ('109', 'Single', 130, true),
          ('110', 'Deluxe', 320, true),
          ('111', 'Single', 105, true),
          ('112', 'Double', 155, true),
          ('113', 'Suite', 260, true),
          ('114', 'Single', 115, true),
          ('115', 'Deluxe', 310, true),
          ('116', 'Single', 125, true),
          ('117', 'Double', 165, true),
          ('118', 'Suite', 280, true),
          ('119', 'Single', 135, true),
          ('120', 'Deluxe', 350, true)
        `);
        
        console.log('Inserted 5 dummy rooms into the database.');
      }

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

// Fungsi untuk subscribe google pub/sub
async function subscribeToMessages() {
  const pubSubClient = PubSubClient.getInstance();
  const subscription = pubSubClient.subscription(SUB_NAME);

  subscription.on('message', async (message) => {
    try {
      const db = await Database.getInstance();
      const eventData = JSON.parse(message.data.toString());
      
      if(eventData["type"] == "book"){
        console.log('Received booking event:', eventData);
        // Update room availability
        const { roomId } = eventData;
        await db.run('UPDATE rooms SET availability = ? WHERE room_number = ?', [false, roomId]);
        console.log(`Room ${roomId} availability updated to false`);
      }
      // Acknowledge the message
      message.ack();
    } catch (error) {
      console.error('Failed to process message:', error);
    }
  });

  subscription.on('error', (error) => {
    console.error('Subscription error:', error);
  });
}

// untuk mengambil data kamar
app.get('/list', async (req, res) => {
  try {
    const db = await Database.getInstance();
    const rooms = await db.all('SELECT * FROM rooms');
    res.json(rooms);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// untuk menambah data kamar baru
app.post('/add', async (req, res) => {
  const { room_number, room_type, price, availability } = req.body;

  if (!room_number || !room_type || price === undefined || availability === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const db = await Database.getInstance();
    const result = await db.run(
      'INSERT INTO rooms (room_number, room_type, price, availability) VALUES (?, ?, ?, ?)',
      [room_number, room_type, price, availability]
    );
    res.json({ id: result.lastID, room_number, room_type, price, availability });
  } catch (error) {
    console.error('Error adding room:', error);
    res.status(500).json({ error: 'Failed to add room' });
  }
});

// Initialize and Start the Server
(async () => {
  try {
    await Database.getInstance();
    app.listen(PORT, () => {
      console.log(`Catalog Service running on http://localhost:${PORT}`);
    });

    // Listen event dari broker
    subscribeToMessages();
  } catch (error) {
    console.error('Failed to initialize:', error);
  }
})();
