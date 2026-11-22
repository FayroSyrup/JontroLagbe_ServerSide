import 'dotenv/config';
import { MongoClient } from 'mongodb';
import dns from 'node:dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);
const client = new MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}/`);

// name, category, price, rental type, quantity, location, brand, model, condition
const SAMPLE = [
    ['Concrete Mixer 350L', 'Construction Equipment', 45, 'Daily', 4, 'Mirpur, Dhaka', 'Lutian', 'LT-350', 'Good'],
    ['Cordless Hammer Drill Set', 'Construction Equipment', 12, 'Daily', 10, 'Uttara, Dhaka', 'Makita', 'DHP486', 'Excellent'],
    ['Mirrorless Camera Kit', 'Photography Equipment', 60, 'Daily', 3, 'Dhanmondi, Dhaka', 'Sony', 'A7 III', 'Excellent'],
    ['Studio Lighting Kit', 'Photography Equipment', 25, 'Daily', 5, 'Gulshan, Dhaka', 'Godox', 'SL-60W', 'Good'],
    ['Cargo Pickup Truck', 'Vehicles & Transportation', 220, 'Weekly', 2, 'Chattogram', 'Toyota', 'Hilux', 'Good'],
    ['Delivery Van 1 Ton', 'Vehicles & Transportation', 150, 'Weekly', 3, 'Narayanganj', 'Suzuki', 'Carry', 'Fair'],
    ['Mini Tractor 25HP', 'Agriculture Equipment', 500, 'Monthly', 2, 'Bogura', 'Mahindra', 'Yuvo 575', 'Good'],
    ['Power Sprayer 20L', 'Agriculture Equipment', 8, 'Daily', 12, 'Rajshahi', 'Honda', 'WJR2025', 'New'],
    ['HD Projector 4000 Lumens', 'Electronics', 30, 'Daily', 6, 'Banani, Dhaka', 'Epson', 'EB-X49', 'Excellent'],
    ['Gaming Laptop RTX', 'Electronics', 350, 'Monthly', 4, 'Sylhet', 'ASUS', 'TUF F15', 'Excellent'],
    ['PA Sound System', 'Event Equipment', 70, 'Daily', 3, 'Mohammadpur, Dhaka', 'Yamaha', 'StagePas 400', 'Good'],
    ['Party Tent 10x20', 'Event Equipment', 55, 'Daily', 8, 'Khulna', 'Coleman', 'Pro 10x20', 'Good'],
];

const run = async () => {
    await client.connect();
    const db = client.db('jontrolagbedb');
    const users = db.collection('user');
    const equipment = db.collection('equipment');

    if (await equipment.countDocuments({ seed: true })) {
        console.log('Sample equipment is already added');
        return;
    }

    // sample items belong to the first owner, or the first admin if there is no owner yet
    const owner = (await users.findOne({ role: 'owner' })) || (await users.findOne({ role: 'admin' }));
    if (!owner) {
        console.log('Create an account and make it admin first, then run this again');
        return;
    }

    const docs = SAMPLE.map(([name, category, rentalPrice, rentalType, availableQuantity, location, brand, model, condition], index) => ({
        name,
        description: `${name} in ${condition.toLowerCase()} condition. Clean, tested and ready to use. Delivery can be arranged within the city.`,
        category,
        location,
        rentalPrice,
        rentalType,
        availableQuantity,
        condition,
        brand,
        model,
        image: `https://placehold.co/800x600/png?text=${encodeURIComponent(name)}`,
        terms: 'A refundable security deposit may be needed at delivery. Return the equipment clean and on time. The renter is responsible for any damage.',
        status: 'approved',
        ownerId: owner._id.toString(),
        ownerName: owner.name,
        ownerEmail: owner.email,
        ownerImage: owner.image || '',
        ownerPhone: owner.phone || '',
        seed: true,
        createdAt: new Date(Date.now() - index * 6 * 60 * 60 * 1000),
    }));

    const result = await equipment.insertMany(docs);
    console.log(`Added ${result.insertedCount} sample equipment`);
};

run().finally(() => client.close());