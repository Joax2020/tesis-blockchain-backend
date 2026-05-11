const { Pool } = require('pg');

const urlSupabase = process.env.POSTGRES_URL;
const pgPool = new Pool({ connectionString: urlSupabase, ssl: { rejectUnauthorized: false } }); // 👈 VITAL PARA SUPABASE

// Función maestra para guardar los vectores de un documento
async function guardarVectoresRAG(hashDocumento, vectoresGenerados) {
  const client = await pgPool.connect();
  
  try {
    // Iniciamos una transacción: o se guardan todos los fragmentos, o no se guarda ninguno
    await client.query('BEGIN'); 

    console.log(`💾 [Postgres] Guardando ${vectoresGenerados.length} fragmentos para el documento ${hashDocumento}...`);

    for (const item of vectoresGenerados) {
      // pgvector requiere que el arreglo de números se transforme en texto '[0.1, 0.2...]'
      const vectorString = `[${ item.vector.join(',') }]`;

      // Inserción segura parametrizada (evita inyecciones SQL)
      await client.query(
        `INSERT INTO fragmentos_documentos (documento_hash, texto_fragmento, embedding)
         VALUES ($1, $2, $3)`,
        [hashDocumento, item.texto, vectorString]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ [Postgres] ¡Vectores guardados exitosamente en la memoria espacial!`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ [Postgres] Error crítico al guardar vectores:`, error);
    throw error;
  } finally {
    client.release(); // Siempre liberamos la conexión de vuelta al Pool
  }
}



// Función para buscar los fragmentos más relevantes a una pregunta
async function buscarFragmentosRAG(vectorPregunta, limite = 3, listaHashesPermitidos = []) {
  const client = await pgPool.connect();
  
  try {
    const vectorString = JSON.stringify(vectorPregunta);

    // Si la lista está vacía, devolvemos nada (seguridad total)
    if (listaHashesPermitidos.length === 0) return [];

    const query = `
      SELECT 
        documento_hash, 
        texto_fragmento,
        1 - (embedding <=> $1::vector) as similitud
      FROM fragmentos_documentos
      WHERE documento_hash = ANY($3) -- 🛡️ FILTRO DE PRIVACIDAD
      ORDER BY embedding <=> $1::vector
      LIMIT $2;
    `;

    // Pasamos la lista de hashes como tercer parámetro ($3)
    const result = await client.query(query, [vectorString, limite, listaHashesPermitidos]);
    
    return result.rows;
    
  } catch (error) {
    console.error(`❌ [Postgres] Error al buscar fragmentos:`, error);
    throw error;
  } finally {
    client.release();
  }
}

// ¡No olvides exportarla al final del archivo!
module.exports = { pgPool, guardarVectoresRAG, buscarFragmentosRAG };