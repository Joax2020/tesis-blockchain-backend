// config/database.js
const mongoose = require('mongoose');

const mongoURI = process.env.MONGO_URI;
if (!mongoURI) throw new Error("MONGO_URI no definida en .env");

const connectDB = async () => {
    try {
        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log('✅ Conectado a MongoDB (Autenticado)');
    } catch (err) {
        console.error('❌ Error conectando a MongoDB:', err);
        process.exit(1); // Detiene la app si no hay base de datos
    }
};

module.exports = connectDB;