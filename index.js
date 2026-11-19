import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const app = express();
const port = process.env.PORT || 5000;

// only my client sites can call this api
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000').split(',');

// middleware
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const client = new MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}/`);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("gearhivedb");
// user and session are created by better auth on the client side
const users = database.collection("user");
const sessions = database.collection("session");
const equipment = database.collection("equipment");
const bookings = database.collection("bookings");
const favorites = database.collection("favorites");
const payments = database.collection("payments");

// indexes stop duplicate payments and duplicate favorites
await payments.createIndex({ sessionId: 1 }, { unique: true });
await favorites.createIndex({ customerId: 1, equipmentId: 1 }, { unique: true });

// small helper, returns null if the id is not valid
const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

app.get('/', (req, res) => {
    res.send('JontroLagbe is running')
})

app.listen(port, () => {
    console.log(`JontroLagbe is running on port ${port}`)
})

export default app;