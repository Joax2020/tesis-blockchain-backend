// controllers/documentController.js
const FormData = require('form-data');
const axios = require('axios');
const DocumentoMeta = require('../models/DocumentoMeta');
const { connectToNetwork } = require('../config/fabricConfig');
const { guardarVectoresRAG } = require('../config/postgres');

// 👇 1. Importamos el cerebro de la IA
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 🗺️ MAPA GLOBAL DE TAREAS EN CURSO
const tareasActivas = new Map();

const getDocumentFromBlockchain = async (req, res) => {
    try {
        const { gateway, contract } = await connectToNetwork();
        console.log(`Consultando Blockchain ID: ${req.params.id}`);
        const result = await contract.evaluateTransaction('QueryDocument', req.params.id);
        await gateway.disconnect();
        res.json(JSON.parse(result.toString()));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Función auxiliar que hará el trabajo pesado en segundo plano
const procesarFondo = async (id, owner, docType, date, rutaArchivo) => {
    const controller = new AbortController();
    const signal = controller.signal;
    tareasActivas.set(id, { progress: 5, message: "Iniciando...", controller });

    // Helper para actualizar en AMBOS lugares (Map + MongoDB)
    const actualizarProgreso = async (progress, message, status = 'processing') => {
        tareasActivas.set(id, { progress, message, controller });
        // ✅ Persistimos en MongoDB para sobrevivir reinicios
        await DocumentoMeta.findOneAndUpdate(
            { hash: id },
            { processingStatus: status, processingProgress: progress, processingMessage: message }
        );
    };

    let textoExtraido = "Sin texto extraído";
    let vectoresGenerados = [];
    let tituloIA = "Documento Auto-Generado";
    let categoriaIA = "Otro";

    try {
        // 🛠️ CAMBIO 1: LÓGICA DE REINTENTO VS NUEVO
        let documentoExistente = await DocumentoMeta.findOne({ hash: id });
        
        if (!documentoExistente) {
            // Es un documento completamente nuevo
            const docInicial = new DocumentoMeta({
                title: tituloIA,
                category: categoriaIA,
                fileUrl: rutaArchivo,
                hash: id,
                ownerEmail: owner,
                isCopy: false,
                processingStatus: 'processing',
                processingProgress: 5,
                processingMessage: 'Iniciando lectura...',
                vectorizado: false // Por defecto inicia en falso
            });
            await docInicial.save();
        } else {
            // Es un REINTENTO. Recuperamos los datos antiguos para no sobrescribirlos.
            tituloIA = documentoExistente.title || tituloIA;
            categoriaIA = documentoExistente.category || categoriaIA;
        }

        // 1. OCR
        if (signal.aborted) throw new Error("Cancelado");
        await actualizarProgreso(25, "Analizando páginas (OCR pesado)...");

        const formData = new FormData();
        const respuestaCloudinary = await axios.get(rutaArchivo, { responseType: 'stream' });
        formData.append('file', respuestaCloudinary.data, 'documento_nube.pdf');

        let ocrProgress = 25;
        const ocrStartTime = Date.now();

        const heartbeat = setInterval(async () => {
            if (ocrProgress < 82) {
                const incremento = ocrProgress < 50 ? 3 : ocrProgress < 70 ? 2 : 1;
                ocrProgress += incremento;
                const segundos = Math.round((Date.now() - ocrStartTime) / 1000);
                const mins = Math.floor(segundos / 60);
                const segs = segundos % 60;
                const tiempoTexto = mins > 0 ? `~${mins}m ${segs}s transcurridos` : `~${segs}s transcurridos`;
                await actualizarProgreso(ocrProgress, `OCR en curso... (${tiempoTexto})`);
            }
        }, 30000);

        let ocrResponse;
        try {
            ocrResponse = await axios.post(`${process.env.OCR_SERVICE_URL}/api/extraer`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: 600000,
                signal: signal
            });
        } finally {
            clearInterval(heartbeat);
        }

        if (ocrResponse.data && ocrResponse.data.status === 'success') {
            textoExtraido = ocrResponse.data.texto_crudo;
            vectoresGenerados = ocrResponse.data.vectores || [];
        }

        // 2. Llama 3
        if (signal.aborted) throw new Error("Cancelado");
        await actualizarProgreso(50, "Llama 3 clasificando documento...");

        if (textoExtraido !== "Sin texto extraído" && textoExtraido.trim().length > 20) {
            const textoCorto = textoExtraido.substring(0, 1500);
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Devuelve JSON con 'titulo' y 'categoria' ('Certificado', 'Carnet', 'Contrato', 'Factura', 'Otro')." },
                    { role: "user", content: textoCorto }
                ],
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" }
            });
            const iaResponse = JSON.parse(completion.choices[0].message.content);
            tituloIA = iaResponse.titulo || tituloIA;
            categoriaIA = iaResponse.categoria || categoriaIA;
        }

        // 3. ACTUALIZAMOS metadatos
        if (signal.aborted) throw new Error("Cancelado");
        await actualizarProgreso(70, "Guardando metadatos (MongoDB)...");

        await DocumentoMeta.findOneAndUpdate(
            { hash: id },
            { title: tituloIA, category: categoriaIA, extractedText: textoExtraido }
        );

        // 4. Blockchain
        if (signal.aborted) throw new Error("Cancelado");
        await actualizarProgreso(85, "Sellando inmutabilidad en Blockchain...");

        try {
            const { gateway, contract } = await connectToNetwork();
            await contract.submitTransaction('CreateDocument', id, owner, docType, date);
            await gateway.disconnect();
        } catch (errorBlockchain) {
            // 🛠️ CAMBIO 2: SI ES UN REINTENTO, LA BLOCKCHAIN DIRÁ "YA EXISTE". LO IGNORAMOS.
            if (errorBlockchain.message && errorBlockchain.message.includes('ya existe')) {
                console.log(`[Blockchain] El hash ${id} ya estaba sellado. Saltando paso...`);
            } else {
                throw errorBlockchain; // Si es otro error grave, explotamos normal
            }
        }

        // 5. PostgreSQL
        if (signal.aborted) throw new Error("Cancelado");
        await actualizarProgreso(95, "Vectorizando para la IA (Postgres)...");

        if (vectoresGenerados.length > 0) {
            await guardarVectoresRAG(id, vectoresGenerados);
            
            // 🛠️ CAMBIO 3: 🚩 LA BANDERA DE VICTORIA
            await DocumentoMeta.findOneAndUpdate({ hash: id }, { vectorizado: true });
            console.log(`✅ Vectores guardados y bandera activada para: ${id}`);
        }

        // Éxito final
        await actualizarProgreso(100, "¡Completado!", 'completed');
        setTimeout(() => tareasActivas.delete(id), 5000);

    } catch (error) {
        // ... (Tu bloque de error original se queda exactamente igual)
        if (axios.isCancel(error) || error.message === "Cancelado") {
            console.log(`🛑 [Cancelado] Proceso abortado para ${id}.`);
            await DocumentoMeta.findOneAndUpdate(
                { hash: id },
                { processingStatus: 'error', processingMessage: 'Cancelado por el usuario' }
            );
        } else {
            console.error(`❌ Error en fondo para ${id}:`, error);
            tareasActivas.set(id, { progress: -1, message: "Error en el proceso", controller });
            await DocumentoMeta.findOneAndUpdate(
                { hash: id },
                { processingStatus: 'error', processingMessage: error.message }
            );
        }
    }
};

// Controlador principal (El que responde rápido al usuario)
const uploadDocument = async (req, res) => {
    try {
        const { id, owner, docType, date } = req.body;
        
        if (!id || !owner || !docType || !date) {
            return res.status(400).json({ error: 'Faltan campos obligatorios: id, owner, docType, date.' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo físico.' });
        }

        const rutaArchivo = req.file.path; 

        // 🚨 VERIFICACIÓN RÁPIDA DE DUPLICADOS
        const documentoExistente = await DocumentoMeta.findOne({ hash: id });

        if (documentoExistente) {
    const idCopia = `${id}_copia_${Date.now()}`;  // 👈 ESTA LÍNEA FALTA

    const nuevaCopia = new DocumentoMeta({
        title: `${documentoExistente.title} (Copia)`,
        category: documentoExistente.category || 'Otro',
        fileUrl: rutaArchivo,
        hash: idCopia,       // 👈 idCopia, no id
        ownerEmail: owner,
        extractedText: documentoExistente.extractedText,
        isCopy: true
    });
    await nuevaCopia.save();

    try {
        const { gateway, contract } = await connectToNetwork();
        await contract.submitTransaction('CreateDocument', idCopia, owner, docType, date);
        await gateway.disconnect();
    } catch (blockchainError) {
        await DocumentoMeta.deleteOne({ hash: idCopia });
        console.error("❌ Error registrando copia en Blockchain:", blockchainError);
        return res.status(500).json({ error: 'Error al registrar la copia en Blockchain.' });
    }

    return res.json({
        message: 'El documento ya existía. Se guardó una copia registrada en Blockchain.',
        docId: idCopia,   // 👈 devolver idCopia, no id
        isCopy: true
    });
}

        // 👇 LA MAGIA DE LA ASINCRONÍA 👇
        procesarFondo(id, owner, docType, date, rutaArchivo);

        // Respondemos INMEDIATAMENTE al usuario
        return res.status(202).json({ 
            message: 'Documento recibido. La IA lo está leyendo y clasificando en segundo plano.', 
            docId: id,
            isCopy: false
        });

    } catch (error) {
        console.error("Error general:", error);
        res.status(500).json({ error: 'Error al registrar el documento.' });
    }
};

// Controlador para consultar el estado del proceso en segundo plano
const checkDocumentStatus = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Primero revisamos el Map (más rápido, en memoria)
        if (tareasActivas.has(id)) {
            const tarea = tareasActivas.get(id);
            if (tarea.progress === -1) return res.json({ status: 'error', message: tarea.message });
            return res.json({
                status: tarea.progress === 100 ? 'completed' : 'processing',
                progress: tarea.progress,
                message: tarea.message
            });
        }

        // 2. ✅ Si el Map no tiene nada (server reiniciado), consultamos MongoDB
        const documento = await DocumentoMeta.findOne({ hash: id });
        if (documento) {
            // Si quedó atascado en 'processing' por un reinicio, lo marcamos como error
            if (documento.processingStatus === 'processing') {
                return res.json({
                    status: 'error',
                    progress: documento.processingProgress,
                    message: 'El proceso fue interrumpido por un reinicio del servidor. Por favor, sube el documento nuevamente.'
                });
            }
            return res.json({
                status: documento.processingStatus,
                progress: documento.processingProgress,
                message: documento.processingMessage,
                textoExtraido: documento.processingStatus === 'completed' ? documento.extractedText : undefined
            });
        }

        return res.json({ status: 'unknown', progress: 0, message: 'Documento no encontrado o cancelado.' });

    } catch (error) {
        res.status(500).json({ error: 'Error al consultar el estado.' });
    }
};

const cancelDocumentUpload = async (req, res) => {
    try {
        const { id } = req.params;

        if (tareasActivas.has(id)) {
            const tarea = tareasActivas.get(id);
            tarea.controller.abort();
            tareasActivas.delete(id);

            // También lo marcamos en MongoDB por si el proceso ya había persistido algo
            await DocumentoMeta.findOneAndUpdate(
                { hash: id },
                { processingStatus: 'error', processingMessage: 'Cancelado por el usuario' }
            );

            return res.json({ message: "Proceso cancelado exitosamente." });
        }

        return res.status(404).json({ message: "No se encontró un proceso activo para cancelar." });

    } catch (error) {
        console.error("❌ Error al cancelar el proceso:", error);
        res.status(500).json({ error: "Error interno al intentar cancelar." });
    }
};

const getUserDocuments = async (req, res) => {
    try {
        const email = req.usuario.email;
        
        const page = parseInt(req.query.page) || 1; 
        const limit = parseInt(req.query.limit) || 6; 
        const search = req.query.search || '';
        const category = req.query.category || '';
        const sort = req.query.sort || 'desc';

        const skip = (page - 1) * limit;

        // 🧠 CREAMOS EL FILTRO INTELIGENTE PARA MONGODB
        let filtroMongo = { ownerEmail: email };
        
        // Si el usuario escribió algo en el buscador...
        if (search) {
            filtroMongo.title = { $regex: search, $options: 'i' }; 
        }
        
        // Si el usuario seleccionó una categoría (ej. "Certificado")...
        if (category) {
            filtroMongo.category = category;
        }

        const sortOption = sort === 'desc' ? { uploadDate: -1 } : { uploadDate: 1 };

        // 🚀 BUSCAMOS APLICANDO EL FILTRO ANTES DE PAGINAR
        const misDocs = await DocumentoMeta.find(filtroMongo)
            .sort(sortOption)
            .skip(skip)
            .limit(limit);

        // 🚀 CONTAMOS EL TOTAL DE PÁGINAS APLICANDO EL MISMO FILTRO
        const total = await DocumentoMeta.countDocuments(filtroMongo);

        res.json({
            docs: misDocs,
            totalPages: Math.ceil(total / limit) || 1, // (Asegura que mínimo sea 1)
            currentPage: page,
            totalDocs: total
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getDocumentHistory = async (req, res) => {
    try {
        const hash = req.params.hash;
        console.log(`Buscando historial en Blockchain para el hash: ${hash}`);

        const { gateway, contract } = await connectToNetwork();
        const resultBytes = await contract.evaluateTransaction('HistoryOfDocument', hash);
        await gateway.disconnect();

        const resultString = new TextDecoder().decode(resultBytes);
        const historial = JSON.parse(resultString);

        res.json(historial);

    } catch (error) {
        console.error("Error obteniendo el historial de la Blockchain:", error);
        res.status(500).json({ error: 'Error al consultar la línea de tiempo en la Blockchain.' });
    }
};

const reintentarOCR = async (req, res) => {
    const { hash } = req.params;

    try {
        const doc = await DocumentoMeta.findOne({ hash, ownerEmail: req.usuario.email });
        
        if (!doc) {
            return res.status(404).json({ message: "Documento no encontrado" });
        }

        // ✅ Cambiamos la condición: solo bloqueamos si YA está vectorizado correctamente
        if (doc.vectorizado === true) {
            return res.status(400).json({ message: "Este documento ya fue procesado correctamente por la IA." });
        }

        // Reseteamos el estado para que el polling funcione desde el frontend
        await DocumentoMeta.findOneAndUpdate(
            { hash },
            { 
                processingStatus: 'processing', 
                processingProgress: 0, 
                processingMessage: 'Reintentando...' 
            }
        );

        procesarFondo(doc.hash, doc.ownerEmail, doc.category, doc.uploadDate?.toISOString() || new Date().toISOString(), doc.fileUrl);

        res.json({ message: "Proceso de reintento iniciado", status: "processing" });

    } catch (error) {
        console.error("Error al reintentar OCR:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
};

const editarMetadatos = async (req, res) => {
    const { hash } = req.params;
    const { nuevoTitulo, nuevaCategoria } = req.body;
    const userEmail = req.usuario.email;

    try {
        const docActualizado = await DocumentoMeta.findOneAndUpdate(
            { hash, ownerEmail: userEmail }, // 🛡️ Seguridad: Solo el dueño edita
            { title: nuevoTitulo, category: nuevaCategoria },
            { new: true }
        );

        if (!docActualizado) {
            return res.status(404).json({ message: "No se encontró el documento o no tienes permiso." });
        }

        res.json({ message: "Documento actualizado correctamente", doc: docActualizado });
    } catch (error) {
        res.status(500).json({ message: "Error al actualizar metadatos" });
    }
};

module.exports = { 
    getDocumentFromBlockchain, 
    uploadDocument, 
    getUserDocuments, 
    getDocumentHistory,
    checkDocumentStatus,
    cancelDocumentUpload,
    reintentarOCR,
    editarMetadatos
};