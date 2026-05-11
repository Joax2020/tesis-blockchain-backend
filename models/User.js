const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // 👈 1. Importamos bcryptjs

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: false }, // No obligatorio para usuarios de Google
    googleId: { type: String, required: false }, // Solo para usuarios de Google
    fullName: { type: String, required: true },
    role: { type: String, default: 'estudiante' },
    createdAt: { type: Date, default: Date.now },
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String }
});

// 🛡️ 2. HOOK PARA ENCRIPTAR LA CONTRASEÑA ANTES DE GUARDARLA
UserSchema.pre('save', async function () { // 👈 Quitamos la palabra "next" de aquí
    // Si la contraseña no fue modificada o no existe (ej. login con Google), no hacemos nada
    if (!this.isModified('password') || !this.password) {
        return; // 👈 Simplemente hacemos un "return" normal
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// 🛡️ 3. MÉTODO PARA COMPARAR LA CONTRASEÑA EN EL LOGIN
UserSchema.methods.matchPassword = async function (enteredPassword) {
    // Si la cuenta es de Google y no tiene password, rechazamos la comparación manual
    if (!this.password) return false; 
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);