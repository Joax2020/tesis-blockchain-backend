// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { register, login, verifyEmail, googleLogin, logout } = require('../controllers/authController');

// Estas rutas se sumarán al "/auth" que definiremos en el index.js
router.post('/register', register);
router.post('/login', login);
router.get('/verify/:token', verifyEmail); // Ruta para verificar el correo (nuevo endpoint)
router.post('/google-login',googleLogin); // Ruta para login con Google (nuevo endpoint)
router.post('/logout', logout); // Ruta para cerrar sesión (nuevo endpoint)

module.exports = router;