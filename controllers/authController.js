// controllers/authController.js
const User = require('../models/User');
const jwt = require('jsonwebtoken'); // 👈 1. Importamos la fábrica de tokens
const crypto = require('crypto'); // 👈 Importamos crypto (ya viene con Node.js)

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); // 👈 Tu variable de entorno
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// 📧 CONFIGURACIÓN DEL CARTERO (Nodemailer)
// 📧 CONFIGURACIÓN DEL CARTERO (Nodemailer) - VERSIÓN MEJORADA

const generarToken = (user) => {
    return jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
};



const register = async (req, res) => {
    try {
        const { email, password, fullName, captchaToken } = req.body;

        if (!captchaToken) {
            return res.status(400).json({ error: 'Token de seguridad faltante.' });
        }

        // Verificación de reCAPTCHA
        const secretKey = process.env.RECAPTCHA_SECRET;
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaToken}`;
        const googleResponse = await fetch(verifyUrl, { method: 'POST' });
        const googleData = await googleResponse.json();
        
        if (!googleData.success) {
            return res.status(400).json({ error: 'Validación antibots fallida.' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }

        const verificationToken = crypto.randomBytes(20).toString('hex');
        const newUser = new User({ email, password, fullName, verificationToken });
        await newUser.save();

        // 💌 ENVÍO DE CORREO CON MANEJO DE ERRORES MEJORADO
        const enlaceVerificacion = `${process.env.BACKEND_URL}/auth/verify/${verificationToken}`;
        
        const mailOptions = {
            from: `"Gestor Documental" <${process.env.EMAIL_USER}>`,
            to: newUser.email,
            subject: '🎓 Verifica tu cuenta en el Gestor Documental',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
                    <h2 style="color: #646cff;">¡Bienvenido, ${fullName}!</h2>
                    <p>Gracias por registrarte en nuestra plataforma descentralizada.</p>
                    <p>Para activar tu cuenta, por favor haz clic en el siguiente botón:</p>
                    <a href="${enlaceVerificacion}" style="background-color: #2ecc71; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin-top: 10px;">Verificar mi Correo</a>
                    <p style="margin-top: 20px; font-size: 0.8rem; color: #666;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${enlaceVerificacion}</p>
                </div>
            `
        };

        // Envío con async/await para manejar errores correctamente
        try {
    const { data, error: resendError } = await resend.emails.send({
        from: 'Gestor Documental <onboarding@resend.dev>',
        to: newUser.email,
        subject: '🎓 Verifica tu cuenta en el Gestor Documental',
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
                <h2 style="color: #646cff;">¡Bienvenido, ${fullName}!</h2>
                <p>Gracias por registrarte en nuestra plataforma descentralizada.</p>
                <p>Para activar tu cuenta, haz clic en el siguiente botón:</p>
                <a href="${enlaceVerificacion}" style="background-color: #2ecc71; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin-top: 10px;">Verificar mi Correo</a>
                <p style="margin-top: 20px; font-size: 0.8rem; color: #666;">Si el botón no funciona, copia este enlace:<br>${enlaceVerificacion}</p>
            </div>
        `
    });

    if (resendError) {
        console.error('❌ Error Resend:', resendError);
    } else {
        console.log('✅ Correo enviado con Resend, ID:', data.id);
    }
} catch (emailError) {
    console.error('❌ Error enviando correo:', emailError);
}
        
        res.status(201).json({ 
            message: 'Registro exitoso. Revisa tu correo electrónico para verificar tu cuenta.',
            emailSent: true 
        });
        
    } catch (error) {
        console.error("Error en registro:", error);
        res.status(500).json({ error: error.message });
    }
};

const login = async (req, res) => {
    try {
        const { email, password, captchaToken } = req.body;

        if (!captchaToken) {
            return res.status(400).json({ error: 'Token de seguridad faltante.' });
        }
        // 🛡️ 1. Usamos variable de entorno para reCAPTCHA
        const secretKey = process.env.RECAPTCHA_SECRET; 
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaToken}`;
        
        const googleResponse = await fetch(verifyUrl, { method: 'POST' });
        const googleData = await googleResponse.json();
        
        if (!googleData.success) {
            return res.status(400).json({ error: 'Validación antibots fallida. Intenta de nuevo.' });
        }

        const user = await User.findOne({ email });

        if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });
        if (!user.isVerified) return res.status(403).json({ error: 'Debes verificar tu correo antes de ingresar.' });

        // 🛡️ 2. REEMPLAZO: Comparamos usando el método hasheado
        if (!(await user.matchPassword(password))) {
            return res.status(400).json({ error: 'Contraseña incorrecta' });
        }

        const payload = {
            id: user._id,
            email: user.email,
            role: user.role
        };

        // 🛡️ 3. Aseguramos el JWT_SECRET
        const token = generarToken(user);

        res.json({ 
            message: 'Bienvenido', 
            token, // 👈 ¡VUELVE A PONER EL TOKEN AQUÍ!
            user: { id: user._id, name: user.fullName, email: user.email, role: user.role } 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Controlador para validar el correo
const verifyEmail = async (req, res) => {
    try {
        const { token } = req.params;

        // Buscamos al usuario que tenga ese token exacto
        const user = await User.findOne({ verificationToken: token });

        if (!user) {
            return res.status(400).send("<h1>❌ Enlace inválido o expirado.</h1><p>Vuelve a la aplicación para registrarte nuevamente.</p>");
        }

        // ¡Éxito! Cambiamos el estado y borramos el token
        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();

        // Le mostramos un mensaje bonito en el navegador web
        res.send(`
            <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #2ecc71;">✅ ¡Cuenta Verificada!</h1>
                <p>Tu correo <b>${user.email}</b> ha sido validado exitosamente.</p>
                <p>Ya puedes cerrar esta ventana y regresar a la aplicación para iniciar sesión.</p>
                <a href="${process.env.FRONTEND_URL}/login" style="background:#646cff;color:white;padding:8px 16px;border-radius:4px;text-decoration:none;">Ir al Login</a>
            </div>
        `);

    } catch (error) {
        res.status(500).send("<h1>❌ Error interno del servidor.</h1>");
    }
};

// 👇 NUEVA FUNCIÓN PARA GOOGLE
const googleLogin = async (req, res) => {
    try {
        const { credential } = req.body; // Este es el token que nos manda React

        // 1. Verificamos que el token sea auténtico con los servidores de Google
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const { email, name, sub } = payload; // 'sub' es el ID único de Google

        // 2. Buscamos si el usuario ya existe en nuestra base de datos
        let user = await User.findOne({ email });

        if (!user) {
            // Si no existe, lo creamos automáticamente (sin contraseña y ya verificado)
            user = new User({
                email: email,
                fullName: name,
                googleId: sub,
                isVerified: true, // Asumimos que Google ya verificó este correo
                role: 'estudiante' // Rol por defecto
            });
            await user.save();
        }

        // 3. Generamos NUESTRA Pulsera VIP (JWT)
        const token = generarToken(user);

        res.json({ 
            message: 'Bienvenido', 
            token, // 👈 ¡VUELVE A PONER EL TOKEN AQUÍ!
            user: { id: user._id, name: user.fullName, email: user.email, role: user.role } 
        });

    } catch (error) {
        console.error("Error en Google Login:", error);
        res.status(400).json({ error: 'Token de Google inválido.' });
    }
};

const logout = (req, res) => {
    res.clearCookie('authToken', {
        httpOnly: true,
        secure: true,
        sameSite: 'none'   // 👈 debe coincidir exactamente con cuando se creó
    });
    res.json({ message: 'Sesión cerrada.' });
};

module.exports = { register, login, verifyEmail, googleLogin, logout };