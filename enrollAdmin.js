/*
 * enrollAdmin.js
 * Este script conecta con la CA (Certificate Authority) y genera las credenciales
 * para el administrador, guardándolas en una carpeta ./wallet
 */

'use strict';

const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');

async function main() {
    try {
        // 1. Cargar la configuración de red (Connection Profile) de la Test Network
        const ccpPath = path.resolve(__dirname, '..', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        // 2. Crear una nueva CA Client
        const caInfo = ccp.certificateAuthorities['ca.org1.example.com'];
        const caTLSCACerts = caInfo.tlsCACerts.pem;
        const ca = new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName);

        // 3. Crear una Billetera (Wallet) local para guardar las claves
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        console.log(`Wallet path: ${walletPath}`);

        // 4. Verificar si ya existe el admin
        const identity = await wallet.get('admin');
        if (identity) {
            console.log('El usuario "admin" ya existe en la wallet');
            return;
        }

        // 5. Enrolar al admin (obtener sus certificados)
        // Nota: "admin" y "adminpw" son los defaults de la Test Network
        const enrollment = await ca.enroll({ enrollmentID: 'admin', enrollmentSecret: 'adminpw' });
        
        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: 'Org1MSP',
            type: 'X.509',
        };

        // 6. Guardar en la wallet
        await wallet.put('admin', x509Identity);
        console.log('Exito: El usuario "admin" ha sido enrolado e importado a la wallet');

    } catch (error) {
        console.error(`Error al enrolar admin: ${error}`);
        process.exit(1);
    }
}

main();