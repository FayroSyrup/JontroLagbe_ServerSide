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
const database = connectedClient.db("jontrolagbedb");
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

// checks the bearer token against the session collection
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized' });
    }

    const session = await sessions.findOne({ token });
    // expired sessions are not allowed
    if (!session || new Date(session.expiresAt) < new Date()) {
        return res.status(401).send({ message: 'Unauthorized' });
    }

    const user = await users.findOne({ _id: toObjectId(session.userId) });
    if (!user) {
        return res.status(401).send({ message: 'Unauthorized' });
    }
    if (user.banned) {
        return res.status(403).send({ message: 'Your account is blocked' });
    }

    req.user = user;
    next();
}

// must call these after verifyToken
const verifyRenter = (req, res, next) => {
    if (req.user.role !== 'customer') {
        return res.status(403).send({ message: 'Forbidden' });
    }
    next();
}

const verifyOwner = (req, res, next) => {
    if (req.user.role !== 'owner') {
        return res.status(403).send({ message: 'Forbidden' });
    }
    next();
}

const verifyAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden' });
    }
    next();
}

const verifyOwnerOrAdmin = (req, res, next) => {
    if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden' });
    }
    next();
}

// users related apis
const ROLES = ['customer', 'owner', 'admin'];

app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
    const result = await users.find({}).sort({ createdAt: -1 }).toArray();
    res.send(result);
})

app.get('/users/me', verifyToken, async (req, res) => {
    res.send(req.user);
})

app.patch('/users/me', verifyToken, async (req, res) => {
    const { name, image, phone, address } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).send({ message: 'Name is required' });
    }
    const updatedDoc = {
        $set: {
            name: name.trim(),
            image: image || '',
            phone: phone || '',
            address: address || '',
            updatedAt: new Date(),
        }
    }
    const result = await users.updateOne({ _id: req.user._id }, updatedDoc);
    res.send(result);
})

app.patch('/users/:id/role', verifyToken, verifyAdmin, async (req, res) => {
    const id = toObjectId(req.params.id);
    const { role } = req.body;
    if (!id || !ROLES.includes(role)) {
        return res.status(400).send({ message: 'Invalid request' });
    }
    // admin should not remove own admin access by mistake
    if (id.equals(req.user._id)) {
        return res.status(403).send({ message: 'You cannot change your own role' });
    }
    const result = await users.updateOne({ _id: id }, { $set: { role } });
    res.send(result);
})

app.patch('/users/:id/status', verifyToken, verifyAdmin, async (req, res) => {
    const id = toObjectId(req.params.id);
    const banned = req.body.banned === true;
    if (!id) {
        return res.status(400).send({ message: 'Invalid user id' });
    }
    if (id.equals(req.user._id)) {
        return res.status(403).send({ message: 'You cannot block yourself' });
    }
    const result = await users.updateOne({ _id: id }, { $set: { banned } });
    // blocked user is logged out everywhere
    if (banned) {
        await sessions.deleteMany({ userId: { $in: [req.params.id, id] } });
    }
    res.send(result);
})

// equipment related apis
const CATEGORIES = [
    'Construction Equipment',
    'Photography Equipment',
    'Vehicles & Transportation',
    'Agriculture Equipment',
    'Electronics',
    'Event Equipment',
];
const RENTAL_TYPES = ['Daily', 'Weekly', 'Monthly'];
const CONDITIONS = ['New', 'Excellent', 'Good', 'Fair'];

const str = (value) => String(value || '').trim();

// only pick the fields we allow, ignore everything else
const getEquipmentData = (body) => ({
    name: str(body.name),
    description: str(body.description),
    category: body.category,
    location: str(body.location),
    rentalPrice: Number(body.rentalPrice),
    rentalType: body.rentalType,
    availableQuantity: Number(body.availableQuantity),
    condition: body.condition,
    brand: str(body.brand),
    model: str(body.model),
    image: str(body.image),
    terms: str(body.terms),
})

const validateEquipment = (data) => {
    if (!data.name) return 'Equipment name is required';
    if (!data.description) return 'Description is required';
    if (!CATEGORIES.includes(data.category)) return 'Invalid category';
    if (!data.location) return 'Location is required';
    if (!(data.rentalPrice > 0)) return 'Rental price must be more than 0';
    if (!RENTAL_TYPES.includes(data.rentalType)) return 'Invalid rental type';
    if (!Number.isInteger(data.availableQuantity) || data.availableQuantity < 0) return 'Invalid quantity';
    if (!CONDITIONS.includes(data.condition)) return 'Invalid condition';
    if (!data.brand || !data.model) return 'Brand and model are required';
    if (!data.image) return 'Equipment image is required';
    if (!data.terms) return 'Rental terms are required';
    return null;
}

app.post('/equipment', verifyToken, verifyOwner, async (req, res) => {
    const data = getEquipmentData(req.body);
    const error = validateEquipment(data);
    if (error) {
        return res.status(400).send({ message: error });
    }
    const item = {
        ...data,
        status: 'pending',
        ownerId: req.user._id.toString(),
        ownerName: req.user.name,
        ownerEmail: req.user.email,
        ownerImage: req.user.image || '',
        ownerPhone: req.user.phone || '',
        createdAt: new Date(),
    }
    const result = await equipment.insertOne(item);
    res.send(result);
})

// owner's own equipment, keep this above /equipment/:id
app.get('/equipment/mine', verifyToken, verifyOwner, async (req, res) => {
    const query = { ownerId: req.user._id.toString() };
    const result = await equipment.find(query).sort({ createdAt: -1 }).toArray();
    res.send(result);
})

// stops special characters from breaking the regex search
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getPaging = (req, defaultLimit = 10) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || defaultLimit, 1), 50);
    return { page, limit, skip: (page - 1) * limit };
}

const sendPaged = async (res, collection, query, sort, { page, limit, skip }) => {
    const total = await collection.countDocuments(query);
    const data = await collection.find(query).sort(sort).skip(skip).limit(limit).toArray();
    res.send({ data, total, page, totalPages: Math.ceil(total / limit) });
}

const SORT_OPTIONS = {
    'price-asc': { rentalPrice: 1, _id: 1 },
    'price-desc': { rentalPrice: -1, _id: 1 },
    newest: { createdAt: -1, _id: -1 },
}

// public list, only approved equipment. home page uses ?limit=6
app.get('/equipment', async (req, res) => {
    const { search, category, rentalType, minPrice, maxPrice, availability, sort } = req.query;
    const query = { status: 'approved' };

    if (search) {
        const safe = escapeRegex(search.trim());
        query.$or = [
            { name: { $regex: safe, $options: 'i' } },
            { location: { $regex: safe, $options: 'i' } },
            { category: { $regex: safe, $options: 'i' } },
        ];
    }
    if (category) {
        query.category = category;
    }
    if (rentalType) {
        query.rentalType = rentalType;
    }
    if (minPrice || maxPrice) {
        query.rentalPrice = {};
        if (minPrice) query.rentalPrice.$gte = Number(minPrice);
        if (maxPrice) query.rentalPrice.$lte = Number(maxPrice);
    }
    if (availability === 'available') {
        query.availableQuantity = { $gt: 0 };
    }
    if (availability === 'unavailable') {
        query.availableQuantity = { $lte: 0 };
    }

    await sendPaged(res, equipment, query, SORT_OPTIONS[sort] || SORT_OPTIONS.newest, getPaging(req, 9));
})

app.get('/equipment/:id', verifyToken, async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).send({ message: 'Invalid equipment id' });
    }
    const item = await equipment.findOne({ _id: id });
    const isOwner = item?.ownerId === req.user._id.toString();
    // pending and rejected items are only visible to the owner and admin
    if (!item || (item.status !== 'approved' && !isOwner && req.user.role !== 'admin')) {
        return res.status(404).send({ message: 'Equipment not found' });
    }
    res.send(item);
})

app.put('/equipment/:id', verifyToken, verifyOwnerOrAdmin, async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).send({ message: 'Invalid equipment id' });
    }
    const item = await equipment.findOne({ _id: id });
    if (!item) {
        return res.status(404).send({ message: 'Equipment not found' });
    }
    if (req.user.role === 'owner' && item.ownerId !== req.user._id.toString()) {
        return res.status(403).send({ message: 'Forbidden' });
    }

    const data = getEquipmentData(req.body);
    const error = validateEquipment(data);
    if (error) {
        return res.status(400).send({ message: error });
    }

    const updatedDoc = { $set: { ...data, updatedAt: new Date() } };
    // owner edits need admin approval again
    if (req.user.role === 'owner') {
        updatedDoc.$set.status = 'pending';
    }
    const result = await equipment.updateOne({ _id: id }, updatedDoc);
    res.send(result);
})

app.delete('/equipment/:id', verifyToken, verifyOwnerOrAdmin, async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).send({ message: 'Invalid equipment id' });
    }
    const item = await equipment.findOne({ _id: id });
    if (!item) {
        return res.status(404).send({ message: 'Equipment not found' });
    }
    if (req.user.role === 'owner' && item.ownerId !== req.user._id.toString()) {
        return res.status(403).send({ message: 'Forbidden' });
    }

    // do not delete if customers have paid and not returned yet
    const activeBookings = await bookings.countDocuments({
        equipmentId: req.params.id,
        paymentStatus: 'paid',
        bookingStatus: 'confirmed',
    });
    if (activeBookings > 0) {
        return res.status(409).send({ message: 'This equipment has active rentals' });
    }

    const result = await equipment.deleteOne({ _id: id });
    await favorites.deleteMany({ equipmentId: id });
    res.send(result);
})

const EQUIPMENT_STATUSES = ['pending', 'approved', 'rejected'];

app.get('/admin/equipment', verifyToken, verifyAdmin, async (req, res) => {
    const query = {};
    if (req.query.status) {
        query.status = req.query.status;
    }
    const result = await equipment.find(query).sort({ createdAt: -1 }).toArray();
    res.send(result);
})

app.patch('/equipment/:id/status', verifyToken, verifyAdmin, async (req, res) => {
    const id = toObjectId(req.params.id);
    const { status } = req.body;
    if (!id || !EQUIPMENT_STATUSES.includes(status)) {
        return res.status(400).send({ message: 'Invalid request' });
    }
    const result = await equipment.updateOne({ _id: id }, { $set: { status } });
    res.send(result);
})

// favorites related apis
app.post('/favorites', verifyToken, verifyRenter, async (req, res) => {
    const equipmentId = toObjectId(req.body.equipmentId);
    if (!equipmentId) {
        return res.status(400).send({ message: 'Invalid equipment id' });
    }
    const item = await equipment.findOne({ _id: equipmentId, status: 'approved' });
    if (!item) {
        return res.status(404).send({ message: 'Equipment not found' });
    }
    // upsert so clicking twice does not make duplicates
    const result = await favorites.updateOne(
        { customerId: req.user._id.toString(), equipmentId },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
    );
    res.send(result);
})

// only the ids, used to color the heart button
app.get('/favorites/ids', verifyToken, verifyRenter, async (req, res) => {
    const result = await favorites.find({ customerId: req.user._id.toString() }).toArray();
    res.send(result.map((fav) => fav.equipmentId.toString()));
})

app.get('/favorites', verifyToken, verifyRenter, async (req, res) => {
    const result = await favorites.aggregate([
        { $match: { customerId: req.user._id.toString() } },
        { $sort: { createdAt: -1 } },
        { $lookup: { from: 'equipment', localField: 'equipmentId', foreignField: '_id', as: 'equipment' } },
        { $unwind: '$equipment' },
    ]).toArray();
    res.send(result);
})

app.delete('/favorites/:equipmentId', verifyToken, verifyRenter, async (req, res) => {
    const equipmentId = toObjectId(req.params.equipmentId);
    if (!equipmentId) {
        return res.status(400).send({ message: 'Invalid equipment id' });
    }
    const result = await favorites.deleteOne({ customerId: req.user._id.toString(), equipmentId });
    res.send(result);
})

// bookings related apis
const HOLD_MINUTES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const isDateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(new Date(value));
const countDays = (start, end) => Math.round((new Date(end) - new Date(start)) / DAY_MS) + 1;

// daily = per day, weekly = per started week, monthly = per started 30 days
const calculateAmount = (price, rentalType, days, quantity) => {
    let units = days;
    if (rentalType === 'Weekly') units = Math.ceil(days / 7);
    if (rentalType === 'Monthly') units = Math.ceil(days / 30);
    return price * units * quantity;
}

// how many items are already taken in this date range
const getBookedQuantity = async (equipmentId, start, end) => {
    const holdLimit = new Date(Date.now() - HOLD_MINUTES * 60 * 1000);
    const result = await bookings.aggregate([
        {
            $match: {
                equipmentId,
                startDate: { $lte: end },
                endDate: { $gte: start },
                $or: [
                    { paymentStatus: 'paid', bookingStatus: 'confirmed' },
                    // unpaid bookings hold stock only for a short time
                    { paymentStatus: 'unpaid', bookingStatus: 'pending', createdAt: { $gte: holdLimit } },
                ],
            }
        },
        { $group: { _id: null, total: { $sum: '$quantity' } } },
    ]).toArray();
    return result[0]?.total || 0;
}

app.post('/bookings', verifyToken, verifyRenter, async (req, res) => {
    const { equipmentId, startDate, endDate, contactNumber, deliveryAddress, notes } = req.body;
    const quantity = Number(req.body.quantity);
    const id = toObjectId(equipmentId);
    const today = new Date().toISOString().slice(0, 10);

    if (!id) {
        return res.status(400).send({ message: 'Invalid equipment id' });
    }
    if (!isDateString(startDate) || !isDateString(endDate)) {
        return res.status(400).send({ message: 'Please select valid dates' });
    }
    if (startDate < today) {
        return res.status(400).send({ message: 'Start date cannot be in the past' });
    }
    if (endDate < startDate) {
        return res.status(400).send({ message: 'End date must be after start date' });
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).send({ message: 'Quantity must be at least 1' });
    }
    if (!str(contactNumber) || !str(deliveryAddress)) {
        return res.status(400).send({ message: 'Contact number and delivery address are required' });
    }

    const item = await equipment.findOne({ _id: id, status: 'approved' });
    if (!item) {
        return res.status(404).send({ message: 'Equipment not found' });
    }

    // availability check for the selected dates
    const booked = await getBookedQuantity(equipmentId, startDate, endDate);
    const left = item.availableQuantity - booked;
    if (quantity > left) {
        return res.status(409).send({
            message: left > 0 ? `Only ${left} item(s) available for these dates` : 'Not available for these dates',
        });
    }

    const days = countDays(startDate, endDate);
    const booking = {
        equipmentId,
        equipmentName: item.name,
        equipmentImage: item.image,
        rentalType: item.rentalType,
        unitPrice: item.rentalPrice,
        ownerId: item.ownerId,
        ownerName: item.ownerName,
        ownerEmail: item.ownerEmail,
        customerId: req.user._id.toString(),
        customerName: req.user.name,
        customerEmail: req.user.email,
        startDate,
        endDate,
        days,
        quantity,
        contactNumber: str(contactNumber),
        deliveryAddress: str(deliveryAddress),
        notes: str(notes),
        totalAmount: calculateAmount(item.rentalPrice, item.rentalType, days, quantity),
        paymentStatus: 'unpaid',
        bookingStatus: 'pending',
        createdAt: new Date(),
    }
    const result = await bookings.insertOne(booking);
    res.send({ insertedId: result.insertedId, totalAmount: booking.totalAmount });
})

// customer booking history (paginated)
app.get('/bookings/mine', verifyToken, verifyRenter, async (req, res) => {
    const query = { customerId: req.user._id.toString() };
    await sendPaged(res, bookings, query, { createdAt: -1 }, getPaging(req, 10));
})

// rentals of the owner's equipment
app.get('/bookings/owner', verifyToken, verifyOwner, async (req, res) => {
    const query = { ownerId: req.user._id.toString(), paymentStatus: 'paid' };
    await sendPaged(res, bookings, query, { createdAt: -1 }, getPaging(req, 10));
})

// all rentals for admin
app.get('/bookings', verifyToken, verifyAdmin, async (req, res) => {
    await sendPaged(res, bookings, {}, { createdAt: -1 }, getPaging(req, 10));
})

// one booking, used by the payment step
app.get('/bookings/:id', verifyToken, async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).send({ message: 'Invalid booking id' });
    }
    const booking = await bookings.findOne({ _id: id });
    const userId = req.user._id.toString();
    const allowed = booking && (booking.customerId === userId || booking.ownerId === userId || req.user.role === 'admin');
    if (!allowed) {
        return res.status(404).send({ message: 'Booking not found' });
    }
    res.send(booking);
})

app.listen(port, () => {
    console.log(`JontroLagbe is running on port ${port}`)
})

export default app;