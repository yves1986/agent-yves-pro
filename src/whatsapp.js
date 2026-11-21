// Mode "WhatsApp Web" (whatsapp-web.js + Chrome) : pour un serveur allumé en permanence (Render, VPS, PC).
// Sur Vercel, c'est api/webhook.mjs (API WhatsApp Cloud officielle) qui est utilisé à la place.
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { log, getImagePath, getVideoPath, fileExists, wait, listFiles, toWhatsAppId } = require('./utils');

class WhatsAppService {
    constructor(config, bot) {
        this.config = config;
        this.bot = bot;
        this.isReady = false;
        this.isInitialized = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 20;
        this.keepAliveInterval = null;
        this.checkInterval = null;
        this.sessionPath = path.join(__dirname, '../.wwebjs_auth');
        this.client = null;

        [path.join(__dirname, '../data'), this.sessionPath, path.join(__dirname, '../.wwebjs_cache')]
            .forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });
        log(`Photos disponibles : ${listFiles(path.dirname(getImagePath('x'))).length}, vidéos : ${listFiles(path.dirname(getVideoPath('x'))).length}`);
    }

    async resolveChromePath() {
        if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
        if (process.platform === 'linux') return require('@sparticuz/chromium').executablePath();
        const candidates = process.platform === 'win32'
            ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
            : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
        const found = candidates.find(p => fs.existsSync(p));
        if (!found) throw new Error('Chrome introuvable : définissez PUPPETEER_EXECUTABLE_PATH');
        return found;
    }

    async createClient() {
        const executablePath = await this.resolveChromePath();
        const args = process.platform === 'linux' ? require('@sparticuz/chromium').args : [];
        return new Client({
            authStrategy: new LocalAuth({ dataPath: this.sessionPath }),
            puppeteer: {
                headless: true,
                executablePath,
                args: [...args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                defaultViewport: null,
                protocolTimeout: 120000
            }
        });
    }

    setupEvents() {
        this.client.on('qr', qr => {
            log('QR Code généré');
            console.log('\nScannez ce QR Code avec WhatsApp :');
            qrcode.generate(qr, { small: true });
            console.log(`\nOu ouvrez ce lien : https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}\n`);
            try { fs.writeFileSync(path.join(__dirname, '../qr.txt'), qr); } catch (e) { }
        });

        // L'agent n'est actif qu'à "ready" (après "authenticated", le client n'est pas encore utilisable).
        this.client.on('authenticated', () => log('Authentification réussie'));
        this.client.on('ready', () => {
            this.isReady = true;
            this.isInitialized = true;
            this.reconnectAttempts = 0;
            log('AGENT KADI ACTIF 24/7');
        });

        this.client.on('auth_failure', async (msg) => {
            log(`Échec auth: ${msg}`, 'ERROR');
            this.isReady = false;
            await this.handleReconnection();
        });

        this.client.on('disconnected', async (reason) => {
            log(`Déconnecté: ${reason}`, 'WARNING');
            this.isReady = false;
            if (reason !== 'LOGOUT') await this.handleReconnection();
        });

        this.client.on('error', async (error) => {
            log(`Erreur: ${error.message}`, 'ERROR');
            if (/TIMEOUT|closed|Session/.test(error.message)) {
                this.isReady = false;
                await this.handleReconnection();
            }
        });

        this.client.on('message', async message => {
            if (!this.isReady) return;
            try {
                await this.handleMessage(message);
            } catch (err) {
                log(`Erreur handleMessage: ${err.stack || err.message}`, 'ERROR');
            }
        });

        this.client.on('change_state', (state) => {
            log(`État: ${state}`);
            if (['CONFLICT', 'UNPAIRED', 'UNPAIRED_IDLE'].includes(state)) {
                this.isReady = false;
                this.handleReconnection();
            }
        });
    }

    async handleMessage(message) {
        if (message.fromMe || message.isStatus) return;
        if (message.from.endsWith('@g.us') || message.from === 'status@broadcast') return;
        if (!(await this.bot.store.markProcessed(message.id.id))) return;

        const type = message.type === 'chat' ? 'text' : message.type;
        log(`Message de ${message._data?.notifyName || message.from} [${type}]: ${(message.body || '').substring(0, 50)}`);

        const { replies, notifications } = await this.bot.handle({
            user: message.from.replace('@c.us', ''),
            name: message._data?.notifyName,
            type,
            text: message.body
        });

        for (const r of replies) {
            if (r.kind === 'text') {
                await message.reply(r.text);
                continue;
            }
            const filePath = r.kind === 'video' ? getVideoPath(r.file) : getImagePath(r.file);
            if (!fileExists(filePath)) {
                log(`Média manquant : ${filePath}`, 'ERROR');
                await message.reply(`Ce média n'est pas encore disponible. Consultez notre catalogue : ${this.config.CATALOG_LINK}`);
                continue;
            }
            await message.reply(MessageMedia.fromFilePath(filePath), undefined, { caption: r.caption });
            await wait(500);
        }

        for (const n of notifications) {
            try {
                await this.client.sendMessage(toWhatsAppId(n.to), n.text);
            } catch (err) {
                log(`Échec notification admin: ${err.message}`, 'ERROR');
            }
        }
    }

    // Un seul cycle de reconnexion à la fois (disconnected/error/watchdog peuvent arriver ensemble).
    async handleReconnection() {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        let retryIn = null;
        try {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                log(`Trop de tentatives (${this.maxReconnectAttempts}), nouvel essai dans 5 minutes`, 'FATAL');
                this.reconnectAttempts = 0;
                retryIn = 300000;
                return;
            }
            this.reconnectAttempts++;
            log(`Tentative de reconnexion ${this.reconnectAttempts}/${this.maxReconnectAttempts}`, 'RECONNECT');
            if (this.client) await this.client.destroy().catch(() => { });
            await wait(Math.min(15000 * Math.pow(1.5, this.reconnectAttempts - 1), 60000));
            this.client = await this.createClient();
            this.setupEvents();
            await this.client.initialize();
            log('Reconnexion réussie', 'SUCCESS');
            this.reconnectAttempts = 0;
        } catch (err) {
            log(`Échec de la reconnexion: ${err.message}`, 'ERROR');
            retryIn = 60000;
        } finally {
            this.isReconnecting = false;
            if (retryIn) setTimeout(() => this.handleReconnection(), retryIn);
        }
    }

    setupKeepAlive() {
        if (this.keepAliveInterval) return;
        this.keepAliveInterval = setInterval(() => {
            if (this.isReady && this.client) {
                try { this.client.pupPage?.evaluate(() => 'keep-alive').catch(() => { }); } catch (e) { }
            }
        }, 300000);
        this.checkInterval = setInterval(async () => {
            if (this.isReconnecting) return;
            if (!this.isReady && this.isInitialized) {
                log('Watchdog: agent non prêt, reconnexion...', 'WATCHDOG');
                await this.handleReconnection();
                return;
            }
            if (this.isReady && this.client) {
                const state = await this.client.getState().catch(() => null);
                if (state !== 'CONNECTED') {
                    log(`État anormal: ${state}`, 'WATCHDOG');
                    this.isReady = false;
                    await this.handleReconnection();
                }
            }
        }, 600000);
    }

    async start() {
        try {
            log('Démarrage...');
            this.client = await this.createClient();
            this.setupEvents();
            await this.client.initialize();
            this.setupKeepAlive();
        } catch (err) {
            log(`Erreur démarrage: ${err.message}`, 'FATAL');
            setTimeout(() => this.start(), 10000);
        }
    }

    async forceReconnect() {
        this.isReady = false;
        this.reconnectAttempts = 0;
        await this.handleReconnection();
    }

    getState() { return this.isReady ? 'connected' : 'disconnected'; }
}

module.exports = WhatsAppService;
