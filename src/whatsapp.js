const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const {
    log, getImagePath, getVideoPath, fileExists,
    getArticleImages, getArticleVideos, wait
} = require('./utils');

class WhatsAppService {
    constructor(config, catalogue, iaService) {
        this.config = config;
        this.catalogue = catalogue;
        this.iaService = iaService;
        this.processedMessages = new Set();
        this.memory = {};
        this.lastArticleByUser = new Map();
        this.pendingOrders = new Map();
        this.isReady = false;
        this.isInitialized = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 20;
        this.reconnectDelay = 5000;
        this.keepAliveInterval = null;
        this.checkInterval = null;

        this.memoryPath = path.join(__dirname, '../data/memory.json');
        this.ordersPath = path.join(__dirname, '../data/orders.json');
        this.sessionPath = path.join(__dirname, '../.wwebjs_auth');

        this.storeName = "Au Pays Des Senteurs";
        this.client = null;

        this.ensureDirectories();
    }

    ensureDirectories() {
        const dirs = [
            path.join(__dirname, '../data'),
            this.sessionPath,
            path.join(__dirname, '../.wwebjs_cache'),
            path.join(__dirname, '../media/images'),
            path.join(__dirname, '../media/videos')
        ];
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        });
    }

    async createClient() {
        const executablePath = await chromium.executablePath();
        return new Client({
            authStrategy: new LocalAuth({ dataPath: this.sessionPath }),
            puppeteer: {
                headless: true,
                executablePath: executablePath,
                args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                defaultViewport: null,
                protocolTimeout: 120000
            }
        });
    }

    setupEvents() {
        this.client.on('qr', qr => {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
            log('QR Code généré');
            console.log('\nScannez ce QR Code avec WhatsApp :');
            qrcode.generate(qr, { small: true });
            console.log(`\nOu ouvrez ce lien : ${qrUrl}`);
            console.log('En attente de connexion...\n');
            try { fs.writeFileSync(path.join(__dirname, '../qr.txt'), qr); } catch (e) { }
        });

        this.client.on('authenticated', () => {
            this.isReady = true;
            this.reconnectAttempts = 0;
            log('Authentification réussie');
        });

        this.client.on('ready', () => {
            this.isReady = true;
            this.isInitialized = true;
            this.reconnectAttempts = 0;
            this.loadMemory();
            log('AGENT KADI ACTIF 24/7');
            console.log(`Boutique : ${this.storeName}`);
            console.log(`Contact : ${this.config.CONTACT_PHONE}`);
            console.log(`${this.catalogue.articles.length} articles chargés`);
            console.log('Commandes : !catalogue, info [nom], images [nom], video [nom]');
        });

        this.client.on('auth_failure', async (msg) => {
            log(`Échec auth: ${msg}`);
            this.isReady = false;
            await this.handleReconnection();
        });

        this.client.on('disconnected', async (reason) => {
            log(`Déconnecté: ${reason}`);
            this.isReady = false;
            if (reason !== 'LOGOUT') await this.handleReconnection();
        });

        this.client.on('error', async (error) => {
            log(`Erreur: ${error.message}`);
            if (error.message.includes('TIMEOUT') || error.message.includes('closed')) {
                await this.handleReconnection();
            }
        });

        this.client.on('message', async message => {
            if (this.isReady) await this.handleMessage(message);
        });

        this.client.on('change_state', (state) => {
            log(`État: ${state}`);
            if (['CONFLICT', 'UNPAIRED', 'UNPAIRED_IDLE'].includes(state)) {
                this.isReady = false;
                this.handleReconnection();
            }
        });
    }

    async handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            log(`Trop de tentatives`, 'FATAL');
            this.reconnectAttempts = 0;
            setTimeout(() => this.handleReconnection(), 60000);
            return;
        }
        this.reconnectAttempts++;
        log(`Tentative ${this.reconnectAttempts}`);
        try {
            if (this.client) await this.client.destroy().catch(() => { });
            const delay = Math.min(5000 * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
            await wait(delay);
            this.client = await this.createClient();
            this.setupEvents();
            await this.client.initialize();
            log('Reconnexion réussie');
            this.reconnectAttempts = 0;
        } catch (err) {
            log(`Échec reconnexion: ${err.message}`);
            setTimeout(() => this.handleReconnection(), 30000);
        }
    }

    setupKeepAlive() {
        this.keepAliveInterval = setInterval(() => {
            if (this.isReady && this.client) {
                try { this.client.pupPage?.evaluate(() => 'keep-alive').catch(() => { }); } catch (e) { }
            }
        }, 30000);

        this.checkInterval = setInterval(async () => {
            if (!this.isReady && this.isInitialized) {
                log('Watchdog: reconnexion');
                await this.handleReconnection();
            }
            if (this.isReady) {
                try {
                    const state = await this.client.getState().catch(() => null);
                    if (state !== 'CONNECTED') {
                        log(`État anormal: ${state}`);
                        this.isReady = false;
                        await this.handleReconnection();
                    }
                } catch (err) {
                    log(`Erreur état: ${err.message}`);
                    this.isReady = false;
                    await this.handleReconnection();
                }
            }
        }, 120000);
    }

    loadMemory() {
        if (fs.existsSync(this.memoryPath)) {
            try { this.memory = JSON.parse(fs.readFileSync(this.memoryPath, 'utf8')); } catch (e) { this.memory = {}; }
        }
    }

    saveMemory() {
        try { fs.writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2)); } catch (e) { }
    }

    saveOrder(order) {
        let orders = [];
        if (fs.existsSync(this.ordersPath)) {
            try { orders = JSON.parse(fs.readFileSync(this.ordersPath, 'utf8')); } catch (e) { }
        }
        orders.push(order);
        fs.writeFileSync(this.ordersPath, JSON.stringify(orders, null, 2));
        log(`Nouvelle commande: ${order.produit} x ${order.quantite}`);
    }

    async sendImage(message, article, imageName) {
        const imagePath = getImagePath(imageName);
        if (!fileExists(imagePath)) {
            await message.reply(`Photo indisponible pour ${article.nom}`);
            return false;
        }
        try {
            const media = MessageMedia.fromFilePath(imagePath);
            await message.reply(media, undefined, { caption: `${article.nom}` });
            return true;
        } catch (err) {
            log(`Erreur envoi image: ${err.message}`);
            return false;
        }
    }

    async sendVideo(message, article, videoName) {
        const videoPath = getVideoPath(videoName);
        if (!fileExists(videoPath)) {
            await message.reply(`Vidéo indisponible pour ${article.nom}`);
            return false;
        }
        try {
            const media = MessageMedia.fromFilePath(videoPath);
            await message.reply(media, undefined, { caption: `${article.nom} (vidéo)` });
            return true;
        } catch (err) {
            log(`Erreur envoi vidéo: ${err.message}`);
            return false;
        }
    }

    async sendAllImages(message, article) {
        const images = getArticleImages(article);
        if (!images.length) {
            await message.reply(`Aucune photo disponible pour ${article.nom}`);
            return;
        }
        await message.reply(`Photos de ${article.nom} :`);
        for (const img of images) {
            await this.sendImage(message, article, img);
            await wait(500);
        }
    }

    async sendAllVideos(message, article) {
        const videos = getArticleVideos(article);
        if (!videos.length) {
            await message.reply(`Aucune vidéo disponible pour ${article.nom}`);
            return;
        }
        await message.reply(`Vidéo de ${article.nom} :`);
        for (const vid of videos) {
            await this.sendVideo(message, article, vid);
            await wait(800);
        }
    }

    getIntro() {
        const phrases = [
            `Bonjour, je suis KADI de la boutique Au Pays Des Senteurs. Comment puis-je vous aider ?`,
            `Bonjour et bienvenue chez Au Pays Des Senteurs. Je suis KADI, votre conseillère.`,
            `Bonjour, merci de me contacter. Je suis KADI, je vous aide à découvrir nos produits.`,
            `Bonjour, je vous souhaite une bonne journée. Ici KADI, votre conseillère en produits bien-être.`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getResponsePhrase() {
        const phrases = [
            `Avec plaisir, je vous renseigne.`,
            `Certainement, voici les détails.`,
            `Très bien, je vous explique.`,
            `Parfait, je suis là pour ça.`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getConfirmation() {
        const phrases = [
            `Confirmez-vous cette commande ? (répondez par oui ou non)`,
            `Voulez-vous valider cette commande ?`,
            `Souhaitez-vous passer commande maintenant ?`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getRecadrage() {
        const phrases = [
            `Je suis là pour vous conseiller sur nos produits. Puis-je vous aider à trouver quelque chose ?`,
            `Désolée, je ne peux pas répondre à ça. Je vous propose de voir notre catalogue.`,
            `Je préfère vous parler de nos produits bien-être. Que recherchez-vous ?`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    async handleMessage(message) {
        if (message.from.endsWith('@g.us')) return;
        if (!message.body) return;
        if (this.processedMessages.has(message.id.id)) return;
        this.processedMessages.add(message.id.id);
        setTimeout(() => this.processedMessages.delete(message.id.id), 3000);

        const msg = message.body.trim();
        const sender = message.from;
        const senderName = message._data?.notifyName || 'Client';
        const msgLower = msg.toLowerCase();

        log(`Message de ${senderName}: ${msg.substring(0, 50)}`);

        try {
            // VOCAUX
            if (message.type === 'ptt' || message.type === 'audio') {
                await message.reply(`Je ne peux pas lire les messages vocaux. Pouvez-vous écrire votre demande ? Merci.`);
                return;
            }

            // SALUTATIONS
            if (['bonjour', 'salut', 'hello', 'hi', 'bonsoir'].some(s => msgLower.includes(s))) {
                await message.reply(this.getIntro());
                return;
            }

            // MERCI
            if (msgLower.includes('merci')) {
                await message.reply(`Avec plaisir. N'hésitez pas si vous avez d'autres questions.`);
                return;
            }

            // AU REVOIR
            if (msgLower.includes('au revoir') || msgLower.includes('a plus') || msgLower.includes('bye')) {
                await message.reply(`Au revoir, à bientôt chez Au Pays Des Senteurs.`);
                return;
            }

            // RECADRAGE
            const horsSujet = ['amour', 'relation', 'sexe', 'coucher', 'sortir', 'rendez-vous', 'mariage'];
            if (horsSujet.some(m => msgLower.includes(m)) &&
                !msgLower.includes('produit') && !msgLower.includes('bien-etre')) {
                await message.reply(this.getRecadrage());
                return;
            }

            // ========== COMMANDES ==========
            if (msgLower === '!catalogue' || msgLower === '!cat') {
                const categoriesCount = this.catalogue.getCategoriesWithCount();
                let reponse = `Catalogue Au Pays Des Senteurs\n\n`;
                for (const [cat, count] of Object.entries(categoriesCount)) {
                    if (count > 0) {
                        reponse += `${cat} (${count} produit${count > 1 ? 's' : ''})\n`;
                        const items = this.catalogue.articles.filter(a => a.categorie === cat && a.disponible);
                        items.slice(0, 5).forEach(a => {
                            reponse += `  - ${a.nom} : ${a.prix.toLocaleString()} FCFA\n`;
                        });
                        if (items.length > 5) reponse += `  ... et ${items.length - 5} autre(s)\n`;
                        reponse += '\n';
                    }
                }
                reponse += `Pour plus d'infos : "info [nom]". Pour commander : "je commande [nom]"`;
                await message.reply(reponse);
                return;
            }

            if (msgLower === '!categories') {
                const categoriesCount = this.catalogue.getCategoriesWithCount();
                let reponse = `Catégories :\n`;
                for (const [cat, count] of Object.entries(categoriesCount)) {
                    if (count > 0) reponse += `- ${cat} (${count} article${count > 1 ? 's' : ''})\n`;
                }
                await message.reply(reponse);
                return;
            }

            if (msgLower === '!aide' || msgLower === '!help') {
                const aide = `Commandes :
- !catalogue : voir tous les produits
- !categories : voir les catégories
- info [nom] : détails d'un produit
- images [nom] : photos
- video [nom] : vidéo
- contact : coordonnées
- je commande [nom] : passer commande`;
                await message.reply(aide);
                return;
            }

            if (msgLower === '!contact' || msgLower === 'contact') {
                await message.reply(`Contact : ${this.config.CONTACT_PHONE}`);
                return;
            }

            // IMAGES
            if (msgLower.startsWith('images ')) {
                const query = msg.substring(7);
                const results = this.catalogue.search(query);
                if (results.length) {
                    await this.sendAllImages(message, results[0]);
                    this.lastArticleByUser.set(sender, results[0]);
                } else {
                    await message.reply(`Aucun produit trouvé pour "${query}".`);
                }
                return;
            }

            // VIDEOS
            if (msgLower.startsWith('video ')) {
                const query = msg.substring(6);
                const results = this.catalogue.search(query);
                if (results.length) {
                    await this.sendAllVideos(message, results[0]);
                    this.lastArticleByUser.set(sender, results[0]);
                } else {
                    await message.reply(`Aucun produit trouvé pour "${query}".`);
                }
                return;
            }

            // INFO / PRIX
            if (msgLower.startsWith('info ') || msgLower.startsWith('prix ')) {
                const query = msg.substring(5);
                const results = this.catalogue.search(query);
                if (!results.length) {
                    await message.reply(`Je n'ai pas trouvé "${query}".`);
                    return;
                }
                if (results.length === 1) {
                    const article = results[0];
                    await message.reply(this.catalogue.formatArticle(article));
                    this.lastArticleByUser.set(sender, article);
                } else {
                    await message.reply(this.catalogue.formatList(results, 'Résultats'));
                }
                return;
            }

            // COMMANDE
            if (msgLower.includes('commande') || msgLower.includes('commander') ||
                msgLower.includes('je prends') || msgLower.includes('je veux') ||
                msgLower.includes('acheter') || msgLower.includes('reserver')) {

                let article = null;
                let quantite = 1;
                const qMatch = msg.match(/(\d+)\s*(encens|kit|poudre|miel|suppositoire|encensoir|semence|lait|cendre)/i);
                if (qMatch) quantite = parseInt(qMatch[1]);

                const results = this.catalogue.search(msg);
                if (results.length) article = results[0];
                else if (this.lastArticleByUser.has(sender)) article = this.lastArticleByUser.get(sender);

                if (!article) {
                    await message.reply(`Indiquez le produit. Exemple : "je commande 3 Encens Sarakatane"`);
                    return;
                }

                const total = article.prix * quantite;
                const reponse = `Commande enregistrée.
Produit : ${article.nom}
Quantité : ${quantite}
Total : ${total.toLocaleString()} FCFA
${this.getConfirmation()}`;
                await message.reply(reponse);

                this.pendingOrders.set(sender, { article, quantite, total, clientName: senderName, message: msg });
                return;
            }

            // CONFIRMATION COMMANDE (oui / non)
            if (msgLower === 'oui' || msgLower === 'o') {
                if (this.pendingOrders.has(sender)) {
                    const order = this.pendingOrders.get(sender);
                    const total = order.article.prix * order.quantite;

                    this.saveOrder({
                        client: sender,
                        clientName: order.clientName,
                        produit: order.article.nom,
                        quantite: order.quantite,
                        total: total,
                        message: order.message,
                        date: new Date().toISOString()
                    });

                    const notif = `Nouvelle commande
Client : ${order.clientName}
Tel : ${sender.replace('@c.us', '')}
Produit : ${order.article.nom}
Quantite : ${order.quantite}
Total : ${total.toLocaleString()} FCFA
Message : "${order.message}"`;
                    await this.client.sendMessage(`${this.config.MY_PERSONAL_NUMBER}@c.us`, notif);

                    await message.reply(`Commande confirmée. Merci ! Un conseiller vous contactera au ${this.config.CONTACT_PHONE}.`);
                    this.pendingOrders.delete(sender);
                    return;
                } else {
                    await message.reply(`Je n'ai pas de commande en attente.`);
                }
                return;
            }

            if (msgLower === 'non' || msgLower === 'n') {
                if (this.pendingOrders.has(sender)) {
                    this.pendingOrders.delete(sender);
                    await message.reply(`Commande annulée.`);
                } else {
                    await message.reply(`Je n'ai pas de commande en attente.`);
                }
                return;
            }

            // RECHERCHE PAR CATÉGORIE
            const categories = this.catalogue.categories || [];
            const catMatch = categories.find(c => msgLower.includes(c.toLowerCase()));
            if (catMatch) {
                const results = this.catalogue.searchByCategory(catMatch);
                if (results.length) {
                    await message.reply(this.catalogue.formatList(results, `Catégorie ${catMatch}`));
                    return;
                }
            }

            // ============================================================
            // APPEL A DEEPSEEK POUR TOUTE AUTRE DEMANDE
            // ============================================================
            log(`[DEBUG] Aucune commande détectée, appel à DeepSeek.`);

            const catalogueContext = this.catalogue.articles
                .filter(a => a.disponible)
                .map(a => `- ${a.nom} : ${a.prix ? a.prix.toLocaleString() : 'N/A'} FCFA (${a.categorie})`)
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
                if (this.memory[sender].length > 20) this.memory[sender] = this.memory[sender].slice(-20);
                this.saveMemory();
            } else {
                // Fallback en cas d'échec de DeepSeek
                await message.reply(`Je ne peux pas répondre pour le moment. Veuillez réessayer ou utiliser "!catalogue" pour voir nos produits.`);
            }

        } catch (err) {
            log(`Erreur: ${err.message}`);
            await message.reply(`Désolée, une erreur est survenue. Reessayez ou contactez le support au ${this.config.CONTACT_PHONE}.`);
        }
    }

    async start() {
        try {
            log('Démarrage...');
            this.client = await this.createClient();
            this.setupEvents();
            await this.client.initialize();
            this.setupKeepAlive();
            log('Agent initialisé');
        } catch (err) {
            log(`Erreur démarrage: ${err.message}`, 'FATAL');
            setTimeout(() => this.start(), 10000);
        }
    }

    async forceReconnect() {
        log('Force reconnexion...');
        this.isReady = false;
        try { if (this.client) await this.client.destroy(); } catch (e) { }
        this.client = await this.createClient();
        this.setupEvents();
        await this.client.initialize();
    }

    getState() {
        return this.isReady ? 'connected' : 'disconnected';
    }
}

module.exports = WhatsAppService;