// controllers/chatController.js
require('dotenv').config();
const { buscarFragmentosRAG } = require('../config/postgres');
const { GoogleGenAI } = require('@google/genai');
const Groq = require('groq-sdk');
const Documento = require('../models/DocumentoMeta'); 

const googleAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ==========================================
// 🛠️ LA CAJA DE HERRAMIENTAS DE LA IA
// ==========================================

// Modifica la función para que acepte el email del dueño
async function buscarEnDocumentos(pregunta, ownerEmail) {
    console.log(`🧠 [Herramienta] Ejecutando búsqueda privada para: ${ownerEmail}`);
    try {
        // 1. Buscamos en MongoDB los hashes que pertenecen a este usuario
        const misDocs = await Documento.find({ ownerEmail: ownerEmail }).select('hash');
        const misHashes = misDocs.map(d => d.hash);

        if (misHashes.length === 0) {
            return { textoRAG: "No tienes documentos subidos aún.", arrayFuentes: [] };
        }

        // 2. Generamos el embedding de la pregunta
        const embedResponse = await googleAI.models.embedContent({
            model: 'gemini-embedding-001',
            contents: pregunta,
        });
        const vectorPregunta = embedResponse.embeddings[0].values;

        // 3. Buscamos en Postgres pasándole los hashes permitidos
        const fragmentos = await buscarFragmentosRAG(vectorPregunta, 3, misHashes);
        
        if (fragmentos.length === 0) return { textoRAG: "No se encontró información en tus documentos.", arrayFuentes: [] };
        
        const textoParaIA = fragmentos.map(f => f.texto_fragmento).join('\n---\n');
        const arrayFuentes = fragmentos.map(f => f.texto_fragmento);
        
        return { textoRAG: textoParaIA, arrayFuentes };
    } catch (error) {
        console.error("Error en búsqueda RAG privada:", error);
        return { textoRAG: "Error de seguridad al consultar tus documentos.", arrayFuentes: [] };
    }
}

async function contarDocumentos() {
    try {
        const total = await Documento.countDocuments();
        return `Actualmente hay ${total} documentos en la bóveda.`;
    } catch (error) {
        return "Error al contar los documentos.";
    }
}

async function obtenerUltimoDocumento() {
    try {
        const ultimoDoc = await Documento.findOne().sort({ uploadDate: -1 });
        if (!ultimoDoc) return "No hay documentos subidos aún.";
        return `El último archivo subido es "${ultimoDoc.title}". Se registró el ${new Date(ultimoDoc.uploadDate).toLocaleDateString()}.`;
    } catch (error) {
        return "Error al buscar el último documento.";
    }
}

const availableFunctions = {
    buscar_en_documentos: buscarEnDocumentos,
    contar_documentos: contarDocumentos,
    obtener_ultimo_documento: obtenerUltimoDocumento
};

// ==========================================
// 🤖 EL FLUJO PRINCIPAL DEL CHATBOT
// ==========================================

const realizarPregunta = async (req, res) => {
    try {
        const { pregunta, historial: historialRaw = [] } = req.body;
        const userEmail = req.usuario.email;
        const historial = historialRaw.slice(-20);

        if (!pregunta) return res.status(400).json({ error: "La pregunta no puede estar vacía." });

        let fuentesParaFrontend = []; // 👈 Aquí guardaremos los fragmentos de Postgres

        const messages = [
            {
                role: "system",
                content: "Eres un asistente de Inteligencia Artificial para un sistema de gestión documental universitario basado en Blockchain. Usa las herramientas proporcionadas para responder. Responde siempre de manera natural, profesional y en español."
            },
            ...historial, // 👈 Agregamos el historial del chat
            { role: "user", content: pregunta }
        ];

        const tools = [
            {
                type: "function",
                function: {
                    name: "buscar_en_documentos",
                    description: "Usa esta herramienta SOLO para responder preguntas sobre el contenido interno de los PDFs.",
                    parameters: {
                        type: "object",
                        properties: { query: { type: "string", description: "La frase o tema a buscar." } },
                        required: ["query"]
                    }
                }
            },
            { type: "function", function: { name: "contar_documentos", description: "Cuenta el total de documentos.", parameters: { type: "object", properties: {} } } },
            { type: "function", function: { name: "obtener_ultimo_documento", description: "Obtiene información sobre el último documento subido.", parameters: { type: "object", properties: {} } } }
        ];

        const initialResponse = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: messages,
            tools: tools,
            tool_choice: "auto",
        });

        const responseMessage = initialResponse.choices[0].message;

        // Si la IA responde directo sin RAG
        if (!responseMessage.tool_calls) {
            return res.status(200).json({ respuesta: responseMessage.content, fuentes: [] });
        }

        messages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
            const functionName = toolCall.function.name;
            const functionToCall = availableFunctions[functionName];
            
            let functionArgs = {};
            try { functionArgs = JSON.parse(toolCall.function.arguments); } catch (e) {}
            
            let functionResult;
            
            if (functionName === 'buscar_en_documentos') {
                // 🛡️ LE PASAMOS EL EMAIL DEL USUARIO ACTUAL
                const resultadoRAG = await buscarEnDocumentos(functionArgs.query || pregunta, userEmail);
                functionResult = resultadoRAG.textoRAG; 
                fuentesParaFrontend = resultadoRAG.arrayFuentes;
            } else if (functionName === 'contar_documentos') {
                // También podemos filtrar el conteo por usuario si quieres
                const total = await Documento.countDocuments({ ownerEmail: userEmail });
                functionResult = `Tienes un total de ${total} documentos privados.`;
            } else {
                // Para obtener el último documento también filtramos por dueño
                const ultimoDoc = await Documento.findOne({ ownerEmail: userEmail }).sort({ uploadDate: -1 });
                functionResult = ultimoDoc ? `Tu último archivo es "${ultimoDoc.title}"` : "No tienes archivos.";
            }
            messages.push({
        tool_call_id: toolCall.id,
        role: "tool",
        name: functionName,
        content: String(functionResult),
    });
        }

        const finalResponse = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: messages,
        });

        // 🚀 Enviamos la respuesta junto con los fragmentos crudos
        res.status(200).json({
            respuesta: finalResponse.choices[0].message.content,
            fuentes: fuentesParaFrontend // 👈 ¡La magia viaja al frontend!
        });

    } catch (error) {
        console.error("❌ Error General en el Agente:", error);
        res.status(500).json({ error: "Error interno", respuesta: "Ocurrió un error." });
    }
};

module.exports = { realizarPregunta };