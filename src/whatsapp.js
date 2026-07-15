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
                defaultViewport: null
            }
        });
    }

    setupEvents() {
<<<<<<< HEAD
        this.client.on('qr', qr => {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
            log('QR Code genere');
            console.log('\nScannez ce QR Code avec WhatsApp :');
            qrcode.generate(qr, { small: true });
            console.log(`\nOu ouvrez ce lien : ${qrUrl}`);
            console.log('En attente de connexion...\n');
            try { fs.writeFileSync(path.join(__dirname, '../qr.txt'), qr); } catch (e) { }
        });

        this.client.on('authenticated', () => {
            this.isReady = true;
            this.reconnectAttempts = 0;
            log('Authentification reussie');
        });
=======
      this.client.on('qr', qr => {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
    
    log('📱 QR Code généré', 'INFO');
    console.log('\n📱 SCANNEZ CE QR CODE :');
    
    // Petit QR Code (déjà petit grâce à { small: true })
    qrcode.generate(qr, { small: true });
    
    console.log(`\n👉 Ou ouvrez ce lien : ${qrUrl}`);
    console.log('⏳ En attente de connexion...\n');

    try {
        fs.writeFileSync(path.join(__dirname, '../qr.txt'), qr);
    } catch (err) { }
});
>>>>>>> eeb7abfa6e76416e9da975c4f6933aee53cfa1ec

        this.client.on('ready', () => {
            this.isReady = true;
            this.isInitialized = true;
            this.reconnectAttempts = 0;
            this.loadMemory();
            log('AGENT KADI ACTIF 24/7');
            console.log(`Boutique : ${this.storeName}`);
            console.log(`Contact : ${this.config.CONTACT_PHONE}`);
            console.log(`${this.catalogue.articles.length} articles charges`);
            console.log('Commandes : !catalogue, !categories, info [nom], images [nom], video [nom], contact');
        });

        this.client.on('auth_failure', async (msg) => {
            log(`Echec auth: ${msg}`);
            this.isReady = false;
            await this.handleReconnection();
        });

        this.client.on('disconnected', async (reason) => {
            log(`Deconnecte: ${reason}`);
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
            log(`Etat: ${state}`);
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
            log('Reconnexion reussie');
            this.reconnectAttempts = 0;
        } catch (err) {
            log(`Echec reconnexion: ${err.message}`);
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
                        log(`Etat anormal: ${state}`);
                        this.isReady = false;
                        await this.handleReconnection();
                    }
                } catch (err) {
                    log(`Erreur etat: ${err.message}`);
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

    // ========== MEDIA ==========
    async sendImage(message, article, imageName) {
        const imagePath = getImagePath(imageName);
        if (!fileExists(imagePath)) {
            await message.reply(`Image non disponible pour ${article.nom}`);
            return false;
        }
        try {
            const media = MessageMedia.fromFilePath(imagePath);
            await message.reply(media, undefined, { caption: `${article.nom}` });
            return true;
        } catch (err) {
            log(`Erreur image: ${err.message}`);
            return false;
        }
    }

    async sendVideo(message, article, videoName) {
        const videoPath = getVideoPath(videoName);
        if (!fileExists(videoPath)) {
            await message.reply(`Video non disponible pour ${article.nom}`);
            return false;
        }
        try {
            const media = MessageMedia.fromFilePath(videoPath);
            await message.reply(media, undefined, { caption: `${article.nom} (5 secondes)` });
            return true;
        } catch (err) {
            log(`Erreur video: ${err.message}`);
            return false;
        }
    }

    async sendAllImages(message, article) {
        const images = getArticleImages(article);
        if (!images.length) {
            await message.reply(`Aucune photo disponible pour ${article.nom}`);
            return;
        }
        await message.reply(`${images.length} photo(s) de ${article.nom}`);
        for (const img of images) {
            await this.sendImage(message, article, img);
            await wait(800);
        }
    }

    async sendAllVideos(message, article) {
        const videos = getArticleVideos(article);
        if (!videos.length) {
            await message.reply(`Aucune video disponible pour ${article.nom}`);
            return;
        }
        await message.reply(`${videos.length} video(s) de ${article.nom}`);
        for (const vid of videos) {
            await this.sendVideo(message, article, vid);
            await wait(1500);
        }
    }

    // ========== PHRASES NATURELLES (sans emojis) ==========
    getIntroductionPhrase() {
        const phrases = [
            `Bonjour et bienvenue chez "Au Pays Des Senteurs". Je suis KADI, votre conseillere en produits bien-etre. Comment puis-je vous aider ?`,
            `Bonjour ! Je suis KADI de la boutique "Au Pays Des Senteurs". En quoi puis-je vous etre utile ?`,
            `Bonjour, je vous souhaite une bonne journee. Ici KADI, votre conseillere. Que recherchez-vous ?`,
            `Bonjour et merci de me contacter. Je suis KADI, je vous aide a decouvrir nos produits bien-etre.`,
            `Bonjour, je suis ravie de vous accueillir chez "Au Pays Des Senteurs". Comment puis-je vous assister ?`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getResponsePhrase() {
        const phrases = [
            `Avec plaisir, je vous renseigne sur nos produits.`,
            `Certainement, je vous explique tout de suite.`,
            `Tres bien, voici les informations.`,
            `Parfait, je suis la pour cela.`,
            `Avec grand plaisir, voici les details.`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getCommandPhrase() {
        const phrases = [
            `Merci pour votre commande.`,
            `Commande bien enregistree.`,
            `Super, je valide votre commande.`,
            `Excellent choix.`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getRecadragePhrase() {
        const phrases = [
            `Je suis la pour vous conseiller sur nos produits bien-etre. Puis-je vous aider a trouver un produit ?`,
            `Desolee, je ne peux repondre a cette question. Je suis specialiste des produits bien-etre. Voulez-vous des informations sur un article ?`,
            `Je comprends votre curiosite, mais je prefere vous parler de nos produits. Que puis-je vous montrer ?`,
            `Je vous prie de m'excuser, je ne suis pas habilitee a discuter de ce sujet. Je vous propose de decouvrir notre catalogue.`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    // ========== TEMPS DE REFLEXION ==========
    async think() {
        await wait(2000 + Math.random() * 3000);
    }

    // ========== GESTION DES MESSAGES ==========
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

        log(`Message de ${senderName}: ${msg.substring(0, 50)}`);

        try {
            await this.think();

            // Gestion des vocaux
            if (message.type === 'ptt' || message.type === 'audio') {
                await message.reply(`Desolee, je ne peux pas lire les messages vocaux. Pouvez-vous ecrire votre demande ? Merci.`);
                return;
            }

            // Salutations
            const salutations = ['bonjour', 'salut', 'hello', 'hi', 'bonsoir'];
            if (salutations.some(s => msgLower.includes(s))) {
                await message.reply(this.getIntroductionPhrase());
                return;
            }

            // Merci
            if (msgLower.includes('merci')) {
                await message.reply(`Avec plaisir. N'hesitez pas si vous avez d'autres questions.`);
                return;
            }

            // Au revoir
            if (msgLower.includes('au revoir') || msgLower.includes('a plus') || msgLower.includes('bye')) {
                await message.reply(`Au revoir, a bientot chez "Au Pays Des Senteurs".`);
                return;
            }

            // Recadrage hors sujet
            const motsHors = ['amour', 'relation', 'sexe', 'coucher', 'sortir', 'rendez-vous', 'mariage'];
            if (motsHors.some(m => msgLower.includes(m)) &&
                !msgLower.includes('produit') && !msgLower.includes('bien-etre') && !msgLower.includes('encens')) {
                await message.reply(this.getRecadragePhrase());
                return;
            }

            // Commandes
            if (msgLower === '!catalogue' || msgLower === '!cat') {
                const categoriesCount = this.catalogue.getCategoriesWithCount();
                let reponse = `Catalogue "Au Pays Des Senteurs"\n\n`;
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
                reponse += `Pour plus d'infos : "info [nom]". Pour commander, dites "je commande [nom]" ou "voulez-vous passer commande ?"`;
                await message.reply(reponse);
                return;
            }

            if (msgLower === '!categories' || msgLower === '!catégories') {
                const categoriesCount = this.catalogue.getCategoriesWithCount();
                let reponse = `Categories disponibles :\n`;
                for (const [cat, count] of Object.entries(categoriesCount)) {
                    if (count > 0) reponse += `- ${cat} (${count} article${count > 1 ? 's' : ''})\n`;
                }
                reponse += `\nTapez "!catalogue" pour voir tous les produits.`;
                await message.reply(reponse);
                return;
            }

            if (msgLower === '!aide' || msgLower === '!help') {
                const aide = `Commandes disponibles :
- !catalogue : voir tous les produits
- !categories : voir les categories
- info [nom] : details d'un produit
- images [nom] : photos
- video [nom] : video (5s)
- contact : coordonnees
- Je commande [nom] : passer commande
- Voulez-vous passer commande ? : pour confirmer`;
                await message.reply(aide);
                return;
            }

            if (msgLower === '!contact' || msgLower === 'contact') {
                await message.reply(`Contactez KADI au ${this.config.CONTACT_PHONE}`);
                return;
            }

            // images/videos
            if (msgLower.startsWith('images ')) {
                const query = msg.substring(7);
                const results = this.catalogue.search(query);
                if (results.length) {
                    const article = results[0];
                    await this.sendAllImages(message, article);
                    this.lastArticleByUser.set(sender, article);
                } else {
                    await message.reply(`Aucun produit trouve pour "${query}". Essayez "!catalogue" pour voir la liste.`);
                }
                return;
            }

            if (msgLower.startsWith('video ')) {
                const query = msg.substring(6);
                const results = this.catalogue.search(query);
                if (results.length) {
                    const article = results[0];
                    await this.sendAllVideos(message, article);
                    this.lastArticleByUser.set(sender, article);
                } else {
                    await message.reply(`Aucun produit trouve pour "${query}".`);
                }
                return;
            }

            // info/prix
            if (msgLower.startsWith('info ') || msgLower.startsWith('prix ')) {
                const query = msg.substring(5);
                const results = this.catalogue.search(query);
                if (!results.length) {
                    await message.reply(`Je n'ai pas trouve "${query}". Utilisez "!catalogue" pour voir tous nos produits.`);
                    return;
                }
                if (results.length === 1) {
                    const article = results[0];
                    await message.reply(this.catalogue.formatArticle(article));
                    this.lastArticleByUser.set(sender, article);
                } else {
                    await message.reply(this.catalogue.formatList(results, 'Resultats'));
                }
                return;
            }

            // Commande
            if (msgLower.includes('commande') || msgLower.includes('commander') ||
                msgLower.includes('je prends') || msgLower.includes('je veux') ||
                msgLower.includes('acheter') || msgLower.includes('reserver')) {

                let article = null;
                let quantite = 1;
                const quantiteMatch = msg.match(/(\d+)\s*(encens|kit|poudre|miel|suppositoire|encensoir|semence|lait|cendre)/i);
                if (quantiteMatch) quantite = parseInt(quantiteMatch[1]);

                const results = this.catalogue.search(msg);
                if (results.length) article = results[0];
                else if (this.lastArticleByUser.has(sender)) article = this.lastArticleByUser.get(sender);

                if (!article) {
                    await message.reply(`Pour commander, indiquez le produit. Exemple : "je commande 3 Encens Sarakatane" ou utilisez "info" d'abord.`);
                    return;
                }

                const total = article.prix * quantite;
                const reponse = `${this.getCommandPhrase()} 
Produit : ${article.nom}
Quantite : ${quantite}
Total : ${total.toLocaleString()} FCFA
Contact : ${this.config.CONTACT_PHONE}

Voulez-vous confirmer cette commande ? (repondez par oui ou non)`;
                await message.reply(reponse);

                // Sauvegarder la commande en attente de confirmation (nous la stockerons dans une map)
                if (!this.pendingOrders) this.pendingOrders = new Map();
                this.pendingOrders.set(sender, { article, quantite, total, clientName: senderName, message: msg });

                return;
            }

            // Confirmation de commande (oui/non)
            if (msgLower === 'oui' || msgLower === 'o') {
                if (this.pendingOrders && this.pendingOrders.has(sender)) {
                    const order = this.pendingOrders.get(sender);
                    const total = order.article.prix * order.quantite;

                    // Enregistrer la commande
                    this.saveOrder({
                        client: sender,
                        clientName: order.clientName,
                        produit: order.article.nom,
                        quantite: order.quantite,
                        total: total,
                        message: order.message,
                        date: new Date().toISOString()
                    });

                    // Notifier le vendeur
                    const notification = `Nouvelle commande !
Client : ${order.clientName}
Telephone : ${sender.replace('@c.us', '')}
Produit : ${order.article.nom}
Quantite : ${order.quantite}
Total : ${total.toLocaleString()} FCFA
Message : "${order.message}"
Date : ${new Date().toLocaleString()}`;
                    await this.client.sendMessage(`${this.config.MY_PERSONAL_NUMBER}@c.us`, notification);

                    // Réponse au client
                    await message.reply(`Commande confirmee et enregistree. Merci ! Un conseiller vous contactera sous peu au ${this.config.CONTACT_PHONE}.`);
                    this.pendingOrders.delete(sender);
                    return;
                } else {
                    await message.reply(`Je n'ai pas de commande en attente pour vous. Que puis-je faire d'autre ?`);
                }
                return;
            }

            if (msgLower === 'non' || msgLower === 'n') {
                if (this.pendingOrders && this.pendingOrders.has(sender)) {
                    this.pendingOrders.delete(sender);
                    await message.reply(`Commande annulee. N'hesitez pas si vous changez d'avis.`);
                } else {
                    await message.reply(`Je n'ai pas de commande en attente. Comment puis-je vous aider ?`);
                }
                return;
            }

            // Recherche par categorie
            const categories = this.catalogue.categories || [];
            const catMatch = categories.find(c => msgLower.includes(c.toLowerCase()));
            if (catMatch) {
                const results = this.catalogue.searchByCategory(catMatch);
                if (results.length) {
                    await message.reply(this.catalogue.formatList(results, `Categorie ${catMatch}`));
                    return;
                }
            }

            // IA pour les questions generales
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
                // Fallback sans IA
                await message.reply(`Je vous remercie pour votre message. Pour toute question sur nos produits, n'hesitez pas a me demander. Tapez "!catalogue" pour decouvrir notre gamme.`);
            }

        } catch (err) {
            log(`Erreur traitement: ${err.message}`);
            await message.reply(`Desolee, une erreur s'est produite. Veuillez reessayer ou contacter le support au ${this.config.CONTACT_PHONE}.`);
        }
    }

    // ========== DEMARRAGE ==========
    async start() {
        try {
            log('Demarrage de l agent...');
            this.client = await this.createClient();
            this.setupEvents();
            await this.client.initialize();
            this.setupKeepAlive();
            log('Agent initialise');
        } catch (err) {
            log(`Erreur demarrage: ${err.message}`, 'FATAL');
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
