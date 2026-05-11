// routes/documentRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');
const { realizarPregunta } = require('../controllers/chatController');
const { 
    getDocumentFromBlockchain, 
    uploadDocument, 
    getUserDocuments, 
    getDocumentHistory,
    checkDocumentStatus, // 👈 ¡FALTABA ESTO AQUÍ!
    cancelDocumentUpload,
    reintentarOCR,
    editarMetadatos
} = require('../controllers/documentController');
const verificarToken = require('../middlewares/authMiddleware');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- CONFIGURACIÓN DE MULTER ---
// 🌉 PUENTE ENTRE MULTER Y CLOUDINARY
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'tesis_documentos', // Así se llamará la carpeta en tu nube
    // Aceptamos PDFs e imágenes
    allowed_formats: ['pdf', 'jpg', 'jpeg', 'png'], 
    // Cloudinary por defecto trata todo como imagen. Con esto le decimos que respete los PDFs
    resource_type: 'auto' 
  },
});

const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB

// --- RUTAS DE DOCUMENTOS ---
// OJO: Rutas específicas primero para evitar conflictos
router.get('/documento/historial/:hash', verificarToken, getDocumentHistory);
router.get('/documento/:id', verificarToken, getDocumentFromBlockchain);
router.post('/documento', verificarToken, upload.single('file'), uploadDocument);

// Nuestra nueva ruta para el Polling
router.get('/status/:id', verificarToken, checkDocumentStatus);

// --- RUTAS DE USUARIO ---
router.get('/mis-documentos', verificarToken, getUserDocuments);

router.post('/chat', verificarToken, realizarPregunta);

router.post('/cancel/:id', verificarToken, cancelDocumentUpload);

router.post('/reintentar-ocr/:hash', verificarToken, reintentarOCR);
router.put('/documento/editar/:hash', verificarToken, editarMetadatos);

module.exports = router;