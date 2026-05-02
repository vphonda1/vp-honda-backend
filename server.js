// ====================== BAILEYS WHATSAPP (Final Stable Version) ======================
let qrCodeDataURL = null;
let isConnected = false;
let sock = null;

const startWhatsApp = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 30000,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("🔥 QR EVENT TRIGGERED!");
            QRCode.toDataURL(qr, { width: 320 }).then(url => {
                qrCodeDataURL = url;
                console.log("✅ QR Code Generated Successfully!");
            });
        }

        if (connection === 'open') {
            isConnected = true;
            console.log("🎉 WHATSAPP CONNECTED SUCCESSFULLY!");
        }

        if (connection === 'close') {
            console.log("Connection closed. Reconnecting...");
            setTimeout(startWhatsApp, 8000);
        }
    });

    sock.ev.on('creds.update', saveCreds);
    console.log("✅ Baileys Socket Started");
};

startWhatsApp();