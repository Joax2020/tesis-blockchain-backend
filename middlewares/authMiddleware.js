// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

const verificarToken = (req, res, next) => {

    // ✅ AHORA: lees de la cookie
    const token = req.cookies?.authToken;

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