import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 5000;

// only my client sites can call this api
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000').split(',');

// middleware
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get('/', (req, res) => {
    res.send('JontroLagbe is running')
})

app.listen(port, () => {
    console.log(`JontroLagbe is running on port ${port}`)
})

export default app;