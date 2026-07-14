const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { log } = require('./utils');

class WhatsAppService {
    constructor(config, catalogue, iaService) {
        this.config = config;
        this.catalogue = catalogue;
        this.iaService = iaService;
        this.processedMessages = new Set();
        this.memory = {};
        this.lastArticleByUser = new Map();
        this.isReady = false;
        this.isInitialized = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 20;
        this.reconnectDelay = 5000;
        this.keepAliveInterval = null;
        this.checkInterval = null;

        this.memoryPath = path.join(__dirname, '../data/memory.json');
        this.sessionPath = path.join(__dirname, '../.wwebjs_auth');

        // Créer les dossiers si nécessaire
        this.ensureDirectories();

        this.client = this.createClient();
        this.setupEvents();
    }

    ensureDirectories() {
        const dirs = [
            path.join(__dirname, '../data'),
            this.sessionPath,
            path.join(__dirname, '../.wwebjs_cache')
        ];
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                log(`Dossier créé: ${dir}`, 'SETUP');
            }
        });
    }

    createClient() {
        return new Client({
            authStrategy: new LocalAuth({
                dataPath: this.sessionPath
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-extensions',
                    '--disable-default-apps',
                    '--disable-sync',
                    '--window-size=1280,720'
                ],
                defaultViewport: null,
                ignoreDefaultArgs: ['--disable-extensions']
            }
        });
    }

    setupEvents() {
        // QR Code
        this.client.on('qr', qr => {
            log('📱 QR Code généré - Scannez avec WhatsApp', 'QR');
            console.log('\n📱 SCANNEZ CE QR CODE :');
            qrcode.generate(qr, { small: true });
            console.log('\n⏳ En attente de connexion...\n');

            try {
                // Sauvegarder le QR pour debugging
                fs.writeFileSync(path.join(__dirname, '../qr.txt'), qr);
            } catch (err) { }
        });

        // Authentification réussie
        this.client.on('authenticated', () => {
            this.isReady = true;
            this.reconnectAttempts = 0;
            log('🔐 Authentification réussie', 'AUTH');
        });

        // Client prêt
        this.client.on('ready', () => {
            this.isReady = true;
            this.isInitialized = true;
            this.reconnectAttempts = 0;
            this.loadMemory();
            log('✅ AGENT YVES PRO ACTIF 24/7', 'READY');
            console.log(`📞 ${this.config.CONTACT_PHONE}`);
            console.log(`📦 ${this.catalogue.articles.length} articles chargés`);
            console.log('💡 Commandes: !catalogue, !categories, info [nom]');
            console.log('🔄 Tourne sur Render - 24/7\n');
        });

        // Échec d'authentification
        this.client.on('auth_failure', async (msg) => {
            log(`Échec d'authentification: ${msg}`, 'AUTH_FAIL');
            this.isReady = false;
            await this.handleReconnection();
        });

        // Déconnexion
        this.client.on('disconnected', async (reason) => {
            log(`Déconnecté: ${reason}`, 'DISCONNECT');
            this.isReady = false;

            if (reason !== 'LOGOUT') {
                await this.handleReconnection();
            } else {
                log('Déconnexion volontaire', 'LOGOUT');
            }
        });

        // Erreur
        this.client.on('error', async (error) => {
            log(`Erreur client: ${error.message}`, 'ERROR');
            if (error.message.includes('TIMEOUT') ||
                error.message.includes('closed') ||
                error.message.includes('Session') ||
                error.message.includes('browser')) {
                await this.handleReconnection();
            }
        });

        // Messages
        this.client.on('message', async message => {
            if (this.isReady) {
                await this.handleMessage(message);
            }
        });

        // Changement d'état
        this.client.on('change_state', (state) => {
            log(`État changé: ${state}`, 'STATE');
            if (state === 'CONFLICT' || state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') {
                this.isReady = false;
                this.handleReconnection();
            }
        });
    }

    // ========== RECONNEXION AUTOMATIQUE ==========
    async handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            log(`Trop de tentatives (${this.maxReconnectAttempts})`, 'FATAL');
            // En production, on continue d'essayer mais avec un délai plus long
            this.reconnectAttempts = 0;
            setTimeout(() => this.handleReconnection(), 60000);
            return;
        }

        this.reconnectAttempts++;
        log(`Tentative ${this.reconnectAttempts}/${this.maxReconnectAttempts}`, 'RECONNECT');

        try {
            if (this.client) {
                await this.client.destroy().catch(() => { });
            }

            const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
            log(`Attente de ${delay / 1000}s avant reconnexion`, 'RECONNECT');
            await new Promise(resolve => setTimeout(resolve, delay));

            this.client = this.createClient();
            this.setupEvents();
            await this.client.initialize();

            log('✅ Reconnexion réussie', 'RECONNECT');
            this.reconnectAttempts = 0;
        } catch (err) {
            log(`Échec reconnexion: ${err.message}`, 'RECONNECT_FAIL');
            setTimeout(() => this.handleReconnection(), 30000);
        }
    }

    // ========== KEEP ALIVE ==========
    setupKeepAlive() {
        // Ping toutes les 30 secondes
        this.keepAliveInterval = setInterval(() => {
            if (this.isReady && this.client) {
                try {
                    // Vérifier si la page existe
                    if (this.client.pupPage) {
                        this.client.pupPage.evaluate(() => {
                            return 'keep-alive';
                        }).catch(() => { });
                    }
                } catch (err) {
                    // Ignorer
                }
            }
        }, 30000);

        // Vérification d'état toutes les 2 minutes
        this.checkInterval = setInterval(async () => {
            if (!this.isReady && this.isInitialized) {
                log('Watchdog: Agent non prêt, reconnexion...', 'WATCHDOG');
                await this.handleReconnection();
            }

            // Vérifier si la session est toujours valide
            if (this.isReady) {
                try {
                    const state = await this.client.getState().catch(() => null);
                    if (state !== 'CONNECTED') {
                        log(`État anormal: ${state}`, 'WATCHDOG');
                        this.isReady = false;
                        await this.handleReconnection();
                    }
                } catch (err) {
                    log(`Erreur vérification état: ${err.message}`, 'WATCHDOG');
                    this.isReady = false;
                    await this.handleReconnection();
                }
            }
        }, 120000); // 2 minutes

        // Refresh des groupes toutes les 6 heures
        setInterval(async () => {
            if (this.isReady) {
                try {
                    log('🔄 Refresh des chats...', 'REFRESH');
                    await this.client.getChats();
                } catch (err) {
                    log(`Erreur refresh: ${err.message}`, 'REFRESH');
                    await this.handleReconnection();
                }
            }
        }, 21600000); // 6 heures
    }

    // ========== CHARGEMENT MÉMOIRE ==========
    loadMemory() {
        if (fs.existsSync(this.memoryPath)) {
            try {
                this.memory = JSON.parse(fs.readFileSync(this.memoryPath, 'utf8'));
                log(`${Object.keys(this.memory).length} clients en mémoire`, 'MEMORY');
            } catch (err) {
                this.memory = {};
                log(`Erreur chargement mémoire: ${err.message}`, 'MEMORY');
            }
        }
    }

    saveMemory() {
        try {
            fs.writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2));
        } catch (err) {
            log(`Erreur sauvegarde mémoire: ${err.message}`, 'MEMORY');
        }
    }

    // ========== MESSAGES ==========
    async handleMessage(message) {
        if (message.from.endsWith('@g.us')) return;
        if (!message.body) return;

        if (this.processedMessages.has(message.id.id)) return;
        this.processedMessages.add(message.id.id);
        setTimeout(() => this.processedMessages.delete(message.id.id), 5000);

        const msg = message.body.trim();
        const sender = message.from;
        const senderName = message._data?.notifyName || 'Client';
        const msgLower = msg.toLowerCase();

        log(`📩 ${senderName}: ${msg.substring(0, 60)}`, 'MESSAGE');

        try {
            // Commandes
            if (msgLower === '!catalogue' || msgLower === '!cat') {
                const articles = this.catalogue.articles.filter(a => a.disponible);
                await message.reply(this.catalogue.formatList(articles));
                return;
            }

            if (msgLower === '!categories' || msgLower === '!catégories') {
                let response = '📂 *Catégories disponibles:*\n\n';
                this.catalogue.categories.forEach(c => {
                    const count = this.catalogue.articles.filter(a =>
                        a.categorie === c && a.disponible
                    ).length;
                    response += `📌 ${c} (${count} article${count > 1 ? 's' : ''})\n`;
                });
                await message.reply(response);
                return;
            }

            if (msgLower === '!aide' || msgLower === '!help') {
                const help = `🤖 *Agent Yves Pro*

📖 *Commandes disponibles:*
• !catalogue - Voir tous les articles
• !categories - Voir les catégories
• info [nom] - Détails d'un article
• prix [nom] - Prix d'un article
• contact - Coordonnées

💬 Vous pouvez aussi me poser des questions sur les articles disponibles.`;
                await message.reply(help);
                return;
            }

            if (msgLower === '!contact' || msgLower === 'contact') {
                await message.reply(`📞 *Contactez-nous:*\n☎️ ${this.config.CONTACT_PHONE}`);
                return;
            }

            if (msgLower.startsWith('info ') || msgLower.startsWith('prix ')) {
                const query = msg.substring(5);
                const results = this.catalogue.search(query);

                if (results.length === 0) {
                    await message.reply(`❌ Désolé, je n'ai pas trouvé "${query}".\n🔍 Essayez "!catalogue" pour voir tous nos articles.`);
                    return;
                }

                if (results.length === 1) {
                    await message.reply(this.catalogue.formatFull(results[0]));
                    this.lastArticleByUser.set(sender, results[0]);
                } else {
                    await message.reply(this.catalogue.formatList(results));
                }
                return;
            }

            // Recherche par catégorie
            const categoryMatch = this.catalogue.categories.find(c =>
                msgLower.includes(c.toLowerCase())
            );
            if (categoryMatch) {
                const results = this.catalogue.getByCategory(categoryMatch);
                if (results.length > 0) {
                    await message.reply(this.catalogue.formatList(results));
                    return;
                }
            }

            // IA
            const catalogueContext = this.catalogue.articles
                .filter(a => a.disponible)
                .map(a => `- ${a.nom} : ${a.prix ? a.prix.toLocaleString() : 'N/A'} FCFA (${a.categorie}, ${a.localisation})`)
                .join('\n');

            const history = this.memory[sender] || [];
            const iaResponse = await this.iaService.getResponse(msg, catalogueContext, history);

            if (iaResponse) {
                await message.reply(iaResponse);

                if (!this.memory[sender]) this.memory[sender] = [];
                this.memory[sender].push(
                    { role: 'user', content: msg },
                    { role: 'assistant', content: iaResponse }
                );
                if (this.memory[sender].length > 20) {
                    this.memory[sender] = this.memory[sender].slice(-20);
                }
                this.saveMemory();
            } else {
                await message.reply(`📝 Bien reçu ! Je suis Agent Yves, votre conseiller.

🔍 Pour voir notre catalogue : !catalogue
📂 Par catégorie : !categories
💬 Ou posez-moi une question sur un article.`);
            }
        } catch (err) {
            log(`Erreur traitement message: ${err.message}`, 'ERROR');
            await message.reply(`❌ Une erreur s'est produite. Veuillez réessayer ou contacter le support.`);
        }
    }

    // ========== DÉMARRAGE ==========
    async start() {
        try {
            log('🚀 Démarrage de l\'agent...', 'START');
            await this.client.initialize();
            this.setupKeepAlive();
            log('✅ Agent initialisé avec succès', 'START');
        } catch (err) {
            log(`Erreur démarrage: ${err.message}`, 'FATAL');
            // Réessayer après 10 secondes
            setTimeout(() => this.start(), 10000);
        }
    }

    // ========== FORCE RECONNECT ==========
    async forceReconnect() {
        log('🔁 Force reconnexion...', 'RECONNECT');
        this.isReady = false;
        try {
            await this.client.destroy();
        } catch (err) { }
        this.client = this.createClient();
        this.setupEvents();
        await this.client.initialize();
    }

    // ========== GET STATE ==========
    getState() {
        return this.isReady ? 'connected' : 'disconnected';
    }
}

module.exports = WhatsAppService;