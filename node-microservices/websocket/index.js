const WebSocket = require("ws");
const { PubSub } = require("@google-cloud/pubsub");


const SUB_NAME = "websocket-sub";
const PORT = 3080;

// Singleton untuk koneksi Google PubSub
class PubSubClient {
    static instance;

    static getInstance() {
        if (!PubSubClient.instance) {
        PubSubClient.instance = new PubSub({
            keyFilename: './../broker-key.json', // Replace with your credentials path
        });
        }
        return PubSubClient.instance;
    }
}

// Initialize WebSocket server
const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});
wss.on('headers', (headers) => {
    headers.push('Access-Control-Allow-Origin: *');
});

// Handle WebSocket connections
wss.on("connection", (ws) => {
  console.log("Client connected to WebSocket.");

  ws.on("close", () => {
    console.log("Client disconnected from WebSocket.");
  });
});

// Singleton untuk koneksi Google PubSub
async function subscribeToPubSub() {
  const subscription = PubSubClient.getInstance().subscription(SUB_NAME);

  subscription.on("message", (message) => {
    try {
      const eventData = JSON.parse(message.data.toString());

      console.log("Received event data:", eventData);

      // kirim pesan ke semua websocket yang terkoneksi
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(eventData));
        }
      });

      message.ack();
    } catch (error) {
      console.error("Error processing Pub/Sub message:", error);
    }
  });

  subscription.on("error", (error) => {
    console.error("Subscription error:", error);
  });
}

subscribeToPubSub();
