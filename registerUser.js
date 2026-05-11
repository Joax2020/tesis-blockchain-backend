/*
 * registerUser.js
 * Registra un usuario llamado "appUser" usando las credenciales del "admin"
 */

'use strict';

const { Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const fs = require('fs');
const path = require('path');

async function main() {
    try {
        // 1. Cargar la configuración de red (Connection Profile)
        const ccpPath = path.resolve(__dirname, '..', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        // 2. Crear una nueva CA Client para interactuar con el servidor de certificados
        const caURL = ccp.certificateAuthorities['ca.org1.example.com'].url;
        const ca = new FabricCAServices(caURL);

        // 3. Preparar la Billetera (Wallet)
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        console.log(`Wallet path: ${walletPath}`);

        // 4. Verificar si el usuario ya existe
        const userIdentity = await wallet.get('appUser');
        if (userIdentity) {
            console.log('El usuario "appUser" ya existe en la wallet');
            return;
        }

        // 5. Verificar que exista el admin (necesario para registrar a otros)
        const adminIdentity = await wallet.get('admin');
        if (!adminIdentity) {
            console.log('Error: El "admin" no está en la wallet. Corre enrollAdmin.js primero.');
            return;
        }

        // 6. Construir objeto de usuario admin para autenticar la operación
        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        // 7. Registrar el usuario nuevo, enrolarlo e importar su identidad
        const secret = await ca.register({
            affiliation: 'org1.department1',
            enrollmentID: 'appUser',
            role: 'client'
        }, adminUser);

        const enrollment = await ca.enroll({
            enrollmentID: 'appUser',
            enrollmentSecret: secret
        });

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: 'Org1MSP',
            type: 'X.509',
        };

        await wallet.put('appUser', x509Identity);
        console.log('Exito: Usuario "appUser" registrado e importado a la wallet');

    } catch (error) {
        console.error(`Fallo al registrar usuario: ${error}`);
        process.exit(1);
    }
}

main();