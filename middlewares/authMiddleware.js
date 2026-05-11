// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

const verificarToken = (req, res, next) => {
    // Lee del header: "Authorization: Bearer <token>"
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extrae solo el token

    if (!token) {
        return res.status(401).json({ error: 'Acceso denegado. No autenticado.' });
    }

    try {
        const verificado = jwt.verify(token, process.env.JWT_SECRET);
        req.usuario = verificado;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Sesión expirada. Por favor, inicie sesión nuevamente.' });
    }
};

module.exports = verificarToken;