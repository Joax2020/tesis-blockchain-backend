// config/fabricConfig.js
const { Gateway, Wallets } = require('fabric-network');
const path = require('path');
const fs = require('fs');

const channelName = 'mychannel';
const chaincodeName = 'gestionDoc';
const walletPath = path.join(__dirname, '..', 'wallet'); // Subimos un nivel
const rutaLocal = path.resolve(__dirname, '..', '..', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
const ccpPath = process.env.FABRIC_CCP_PATH || rutaLocal;

const FABRIC_TIMEOUT_MS = 15000; // 15 segundos máximo

// Helper reutilizable para cualquier promesa
function conTimeout(promesa, ms, mensajeError) {
    const reloj = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(mensajeError)), ms)
    );
    return Promise.race([promesa, reloj]);
}

async function connectToNetwork() {
    try {
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const gateway = new Gateway();

        // La conexión tiene máximo 15 segundos para responder
        await conTimeout(
            gateway.connect(ccp, {
                wallet,
                identity: 'appUser',
                discovery: { enabled: true, asLocalhost: true }
            }),
            FABRIC_TIMEOUT_MS,
            `Fabric no respondió en ${FABRIC_TIMEOUT_MS / 1000}s. ¿Está corriendo la red?`
        );

        const network = await gateway.getNetwork(channelName);
        const contract = network.getContract(chaincodeName);

        return { gateway, contract };
    } catch (error) {
        console.error(`Error conectando a la red Fabric: ${error.message}`);
        throw error; // El controlador que llamó a connectToNetwork verá el mensaje claro
    }
}

module.exports = { connectToNetwork };