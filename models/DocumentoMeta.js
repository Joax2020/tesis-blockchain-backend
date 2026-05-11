const mongoose = require('mongoose');

const DocumentoSchema = new mongoose.Schema({
    title: { type: String, required: true },
    category: { type: String, default: 'Otro' },
    fileUrl: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
    ownerEmail: { type: String, required: true },
    uploadDate: { type: Date, default: Date.now },
    status: { type: String, default: 'Valido' },
    extractedText: { type: String, default: '' },
    vectorizado: { type: Boolean, default: false },
    isCopy: { type: Boolean, default: false },
    ocr_aplicado: { type: Boolean, default: false },
    // ✅ NUEVO: Estado del procesamiento en segundo plano
    processingStatus: { 
        type: String, 
        enum: ['pending', 'processing', 'completed', 'error'],
        default: 'pending' 
    },
    processingProgress: { type: Number, default: 0 },
    processingMessage: { type: String, default: '' }
});

module.exports = mongoose.model('DocumentoMeta', DocumentoSchema);