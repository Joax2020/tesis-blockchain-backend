require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const CookieParser = require('cookie-parser');

const connectDB = require('./config/database');
const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes');

const app = express();

// 1. CONFIGURACIÓN INICIAL
const PORT = process.env.PORT || 3000; // 👈 DEFINIDO AQUÍ PARA TODO EL ARCHIVO
app.set('trust proxy', 1); 

// 2. MIDDLEWARES GLOBALES
app.use(CookieParser());
app.use(express.json());

// Configuración de CORS única y limpia
const ALLOWED_ORIGINS = [
    'https://tesis-blockchain-frontend.vercel.app',
    'http://localhost:5173',
    'http://localhost:5174'
];

app.use(cors({
    origin: function (origin, callback) {
        // Permite peticiones sin origin (Postman, curl, apps móviles)
        if (!origin) return callback(null, true);
        
        // Limpiamos posible barra al final antes de comparar
        const originLimpio = origin.replace(/\/$/, '');
        
        if (ALLOWED_ORIGINS.includes(originLimpio)) {
            callback(null, true);
        } else {
            // LOG para ver exactamente qué origin está llegando
            console.log(`🚫 CORS bloqueado. Origin recibido: "${origin}"`);
            callback(new Error('Bloqueado por CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

app.options('/{*path}', cors());

// Seguridad de encabezados
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); 

// 3. LIMITADORES
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Demasiados intentos, por favor intenta de nuevo después de 15 minutos.'
});

// 4. RUTAS
app.use('/uploads', express.static('uploads'));
app.use('/auth', authLimiter, authRoutes);
app.use('/', documentRoutes);

// 5. ARRANQUE DEL SERVIDOR
const iniciarServidor = async () => {
    try {
        await connectDB();
        
        // Limpiar documentos atascados tras reinicio
        const DocumentoMeta = require('./models/DocumentoMeta');
        await DocumentoMeta.updateMany(
            { processingStatus: 'processing' },
            { processingStatus: 'error', processingMessage: 'Servidor reiniciado' }
        );

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Servidor corriendo en el puerto: ${PORT}`);
        });
    } catch (error) {
        console.error('❌ Error al iniciar el servidor:', error);
        process.exit(1);
    }
};

iniciarServidor();

// MANEJO DE ERRORES GLOBALES
process.on('unhandledRejection', (err) => {
    console.error('❌ Promesa no manejada:', err);
});
process.on('uncaughtException', (err) => {
    console.error('❌ Excepción no capturada:', err);
    process.exit(1);
});