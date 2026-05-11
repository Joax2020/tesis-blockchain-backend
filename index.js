require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet'); // 👈 SEGURIDAD
const rateLimit = require('express-rate-limit'); // 👈 SEGURIDAD

const connectDB = require('./config/database');
const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes');

const CookieParser = require('cookie-parser'); // 👈 Para manejar cookies

const app = express();
app.use(CookieParser()); // 👈 Usamos el middleware para parsear las cookies
// 🛡️ 1. Tomamos el puerto del .env o usamos 3000 por defecto
const PORT = process.env.PORT || 3000; 

// 🛡️ 2. Middlewares de Seguridad Global
// Helmet oculta información del servidor. crossOriginResourcePolicy en false permite que tu React cargue los PDFs.
app.use(helmet({ crossOriginResourcePolicy: false })); 

app.use(cors({
    origin: [process.env.FRONTEND_URL, 
            'http://localhost:5173', 
            'http://127.0.0.1:5173',
            'http://localhost:5174',
            'http://127.0.0.1:5174'
        ], // Solo acepta peticiones de tu frontend
    credentials: true
}));

app.use(express.json());

// 🛡️ 3. Limitador de peticiones (Protección contra Fuerza Bruta)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // Limita cada IP a 20 peticiones de login/registro por ventana
    message: 'Demasiados intentos desde esta IP, por favor intenta de nuevo después de 15 minutos.'
});

// Archivos Estáticos
app.use('/uploads', express.static('uploads'));

// Registrar las Rutas
app.use('/auth', authLimiter, authRoutes); // Aplicamos el limitador SOLO a las rutas de autenticación
app.use('/', documentRoutes);

const iniciarServidor = async () => {
    await connectDB();
    
    // Limpiar documentos atascados tras reinicio
    const DocumentoMeta = require('./models/DocumentoMeta');
    await DocumentoMeta.updateMany(
        { processingStatus: 'processing' },
        { processingStatus: 'error', processingMessage: 'Servidor reiniciado' }
    );

    app.listen(PORT, () => {
        console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });
};

iniciarServidor(); // 👈 Esta línea faltaba

process.on('unhandledRejection', (err) => {
    console.error('❌ Promesa no manejada:', err);
});
process.on('uncaughtException', (err) => {
    console.error('❌ Excepción no capturada:', err);
    process.exit(1);
});