const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const {
    log, getImagePath, getVideoPath, fileExists,
    getArticleImages, getArticleVideos, wait, listFiles
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
        this.userStates = new Map();
        this.isReady = false;
        this.isInitialized = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 20;
        this.reconnectDelay = 15000; // 15 secondes minimum
        this.keepAliveInterval = null;
        this.checkInterval = null;

        this.memoryPath = path.join(__dirname, '../data/memory.json');
        this.ordersPath = path.join(__dirname, '../data/orders.json');
        this.sessionPath = path.join(__dirname, '../.wwebjs_auth');
        this.knowledgePath = path.join(__dirname, '../data/knowledge_base.json');

        this.storeName = "Au Pays Des Senteurs";
        this.client = null;

        // Chargement de la base de connaissances
        this.knowledge = this.loadKnowledgeBase();

        this.ensureDirectories();
        this.logMediaFiles();
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

    logMediaFiles() {
        const imageDir = path.join(__dirname, '../media/images');
        const videoDir = path.join(__dirname, '../media/videos');
        log(`📁 Dossier images : ${imageDir} - ${listFiles(imageDir).length} fichiers`);
        log(`📁 Dossier vidéos : ${videoDir} - ${listFiles(videoDir).length} fichiers`);
        if (listFiles(imageDir).length === 0) {
            log(`⚠️ Aucun fichier image trouvé ! Vérifiez que les fichiers sont bien dans media/images/.`, 'WARNING');
        }
    }

    // ========== BASE DE CONNAISSANCES ==========
    loadKnowledgeBase() {
        try {
            if (fs.existsSync(this.knowledgePath)) {
                const data = JSON.parse(fs.readFileSync(this.knowledgePath, 'utf8'));
                log('Base de connaissances chargée avec succès', 'INFO');
                return data;
            } else {
                log('Fichier knowledge_base.json introuvable, utilisation des valeurs par défaut', 'WARNING');
                return { general_faq: [], products: {}, confirmation_keywords: ['oui', 'o', 'ok'] };
            }
        } catch (err) {
            log(`Erreur chargement base de connaissances: ${err.message}`, 'ERROR');
            return { general_faq: [], products: {}, confirmation_keywords: ['oui', 'o', 'ok'] };
        }
    }

    // ========== RECHERCHE DANS LA FAQ ==========
    handleFAQ(userMessage) {
        const msgLower = userMessage.toLowerCase().trim();
        const kb = this.knowledge;

        // 1. FAQ générale
        for (const item of kb.general_faq || []) {
            if (msgLower.includes(item.question.toLowerCase()) || item.question.toLowerCase().includes(msgLower)) {
                return item.answer;
            }
        }

        // 2. FAQ spécifiques des produits
        const products = kb.products || {};
        for (const [key, product] of Object.entries(products)) {
            if (product.faq_specific) {
                for (const item of product.faq_specific) {
                    const q = item.question.toLowerCase();
                    if (msgLower.includes(q) || q.includes(msgLower)) {
                        return item.answer;
                    }
                }
            }
            if (key === 'encens' && product.general_faq) {
                for (const item of product.general_faq) {
                    const q = item.question.toLowerCase();
                    if (msgLower.includes(q) || q.includes(msgLower)) {
                        return item.answer;
                    }
                }
            }
        }

        // 3. Fiche produit (hors encens)
        for (const [key, product] of Object.entries(products)) {
            if (key === 'encens') continue;
            if (product.name && msgLower.includes(product.name.toLowerCase())) {
                let answer = `📦 *${product.name}*\n💰 Prix : ${product.price} FCFA\n📝 Indications : ${product.indications}\n`;
                if (product.dosage) {
                    if (typeof product.dosage === 'object') {
                        answer += `📋 Posologie :\n`;
                        for (const [k, v] of Object.entries(product.dosage)) {
                            answer += `   - ${k} : ${v}\n`;
                        }
                    } else {
                        answer += `📋 Posologie : ${product.dosage}\n`;
                    }
                }
                if (product.duration) answer += `⏳ Durée : ${product.duration}\n`;
                if (product.contre_indications) answer += `⚠️ Contre-indications : ${product.contre_indications}\n`;
                answer += `\n👉 Pour plus d'informations, posez-moi une question précise.`;
                return answer;
            }
        }

        // 4. NOUVEAU : Reconnaître un encens spécifique par son nom
        if (products.encens && products.encens.list) {
            for (const encens of products.encens.list) {
                if (msgLower === encens.name.toLowerCase() || msgLower.includes(encens.name.toLowerCase())) {
                    return `🔥 *${encens.name}*\n💰 Prix : ${encens.price} FCFA\n📌 Utilisation : ${encens.type}\n\n👉 Souhaitez-vous commander cet encens ? (dites "oui" ou "non")`;
                }
            }
        }

        // 5. Liste des encens (si le mot "encens" est présent)
        if (msgLower.includes('encens') && products.encens && products.encens.list) {
            let answer = "🔥 *Nos encens disponibles :*\n\n";
            products.encens.list.forEach(e => {
                answer += `- ${e.name} : ${e.price} FCFA (${e.type})\n`;
            });
            answer += "\n👉 Quel encens vous intéresse ? Je peux vous donner plus de détails.";
            return answer;
        }

        return null;
    }

    // ========== RECONNAISSANCE DE CONFIRMATION (mots entiers) ==========
    isConfirmation(text) {
        const txt = text.toLowerCase().trim();
        const keywords = this.knowledge.confirmation_keywords || ['oui', 'ok'];
        const validKeywords = keywords.filter(kw => kw.length >= 2);
        return validKeywords.some(kw => {
            const regex = new RegExp(`\\b${kw}\\b`, 'i');
            return regex.test(txt);
        });
    }

    // ========== CRÉATION DU CLIENT ==========
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

        this.client.on('ready', async () => {
            this.isReady = true;
            this.isInitialized = true;
            this.reconnectAttempts = 0;
            this.loadMemory();
            log('AGENT KADI ACTIF 24/7');
            console.log(`Boutique : ${this.storeName}`);
            console.log(`Contact : ${this.config.CONTACT_PHONE}`);
            console.log(`${this.catalogue.articles.length} articles chargés`);
            console.log('Commandes : !catalogue, info [nom], images [nom], video [nom]');

            // ============================================================
            // TRAITEMENT DES ANCIENS MESSAGES NON LUS - DÉSACTIVÉ
            // ============================================================
            /*
            try {
                const chats = await this.client.getChats();
                log(`📋 ${chats.length} chats récupérés`, 'INFO');
                let processedCount = 0;

                for (const chat of chats) {
                    if (chat.isGroup) continue;
                    const unreadCount = chat.unreadCount || 0;
                    if (unreadCount === 0) continue;

                    log(`📩 ${chat.name} (${chat.id.user}) - ${unreadCount} message(s) non lu(s)`, 'INFO');

                    const limit = Math.min(unreadCount, 5);
                    const messages = await chat.fetchMessages({ limit: limit });

                    for (const msg of messages.reverse()) {
                        if (msg.fromMe) continue;
                        if (!msg.body && !msg.hasMedia) continue;
                        if (this.processedMessages.has(msg.id.id)) continue;

                        this.processedMessages.add(msg.id.id);
                        setTimeout(() => this.processedMessages.delete(msg.id.id), 5000);

                        log(`📩 (ancien) ${chat.name}: ${msg.body?.substring(0, 50) || '[média]'}`, 'MESSAGE');

                        try {
                            await this.handleMessage(msg);
                            processedCount++;
                            await wait(2000);
                        } catch (err) {
                            log(`❌ Erreur sur message ${msg.id.id}: ${err.message}`, 'ERROR');
                        }
                    }
                }
                log(`📬 ${processedCount} anciens messages traités`, 'INFO');
            } catch (err) {
                log(`Erreur lors du traitement des anciens messages: ${err.message}`, 'ERROR');
            }
            */
        });

        this.client.on('auth_failure', async (msg) => {
            log(`Échec auth: ${msg}`);
            this.isReady = false;
            await this.handleReconnection();
        });

        this.client.on('disconnected', async (reason) => {
            log(`Déconnecté: ${reason}`);
            this.isReady = false;
            if (reason !== 'LOGOUT') {
                await this.handleReconnection();
            } else {
                log('Déconnexion volontaire (LOGOUT) - pas de reconnexion automatique');
            }
        });

        this.client.on('error', async (error) => {
            log(`Erreur: ${error.message}`);
            if (error.message.includes('TIMEOUT') || error.message.includes('closed') || error.message.includes('Session')) {
                this.isReady = false;
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

    // ========== RECONNEXION AUTOMATIQUE AVEC BACKOFF ==========
    async handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            log(`Trop de tentatives (${this.maxReconnectAttempts}), on réessaye plus tard...`, 'FATAL');
            this.reconnectAttempts = 0;
            setTimeout(() => this.handleReconnection(), 300000); // 5 minutes
            return;
        }

        this.reconnectAttempts++;
        log(`Tentative de reconnexion ${this.reconnectAttempts}/${this.maxReconnectAttempts}`, 'RECONNECT');

        try {
            if (this.client) {
                await this.client.destroy().catch(() => { });
            }

            const delay = Math.min(15000 * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
            log(`Attente de ${delay / 1000}s avant reconnexion`, 'RECONNECT');
            await wait(delay);

            this.client = await this.createClient();
            this.setupEvents();
            await this.client.initialize();

            log('✅ Reconnexion réussie', 'SUCCESS');
            this.reconnectAttempts = 0;
        } catch (err) {
            log(`Échec de la reconnexion: ${err.message}`, 'ERROR');
            setTimeout(() => this.handleReconnection(), 60000);
        }
    }

    // ========== KEEP ALIVE ET WATCHDOG ==========
    setupKeepAlive() {
        // Ping toutes les 5 minutes
        this.keepAliveInterval = setInterval(() => {
            if (this.isReady && this.client) {
                try {
                    this.client.pupPage?.evaluate(() => 'keep-alive').catch(() => { });
                } catch (e) { }
            }
        }, 300000); // 5 minutes

        // Vérification de l'état toutes les 10 minutes
        this.checkInterval = setInterval(async () => {
            if (!this.isReady && this.isInitialized) {
                log('Watchdog: agent non prêt, tentative de reconnexion...', 'WATCHDOG');
                await this.handleReconnection();
                return;
            }

            if (this.isReady && this.client) {
                try {
                    const state = await this.client.getState().catch(() => null);
                    if (state !== 'CONNECTED') {
                        log(`État anormal: ${state}`, 'WATCHDOG');
                        this.isReady = false;
                        await this.handleReconnection();
                    }
                } catch (err) {
                    log(`Erreur lors de la vérification de l'état: ${err.message}`, 'WATCHDOG');
                    this.isReady = false;
                    await this.handleReconnection();
                }
            }
        }, 600000); // 10 minutes
    }

    // ========== MÉMOIRE ==========
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

    // ========== ENVOI D'IMAGES ==========
    async sendImage(message, article, imageName) {
        const imagePath = getImagePath(imageName);
        log(`📸 Tentative d'envoi de l'image : ${imagePath}`);
        if (!fileExists(imagePath)) {
            log(`❌ Image manquante : ${imagePath}`, 'ERROR');
            await message.reply(`La photo de ${article.nom} n'est pas encore disponible.`);
            return false;
        }
        try {
            const media = MessageMedia.fromFilePath(imagePath);
            await message.reply(media, undefined, { caption: `${article.nom}` });
            log(`✅ Image envoyée avec succès : ${imageName}`);
            return true;
        } catch (err) {
            log(`❌ Erreur envoi image: ${err.message}`, 'ERROR');
            await message.reply(`Erreur lors de l'envoi de la photo.`);
            return false;
        }
    }

    async sendAllImages(message, article) {
        const images = getArticleImages(article);
        log(`📸 Nombre d'images pour ${article.nom} : ${images.length}`);
        if (!images.length) {
            await message.reply(`Aucune photo disponible pour ${article.nom}.`);
            return;
        }
        await message.reply(`Voici les photos de ${article.nom} :`);
        for (const img of images) {
            await this.sendImage(message, article, img);
            await wait(500);
        }
    }

    // ========== ENVOI DE VIDÉOS ==========
    async sendVideo(message, article, videoName) {
        const videoPath = getVideoPath(videoName);
        log(`🎬 Tentative d'envoi de la vidéo : ${videoPath}`);
        if (!fileExists(videoPath)) {
            log(`❌ Vidéo manquante : ${videoPath}`, 'ERROR');
            await message.reply(`La vidéo de ${article.nom} n'est pas encore disponible.`);
            return false;
        }
        try {
            const media = MessageMedia.fromFilePath(videoPath);
            await message.reply(media, undefined, { caption: `${article.nom} (vidéo)` });
            log(`✅ Vidéo envoyée avec succès : ${videoName}`);
            return true;
        } catch (err) {
            log(`❌ Erreur envoi vidéo: ${err.message}`, 'ERROR');
            await message.reply(`Erreur lors de l'envoi de la vidéo.`);
            return false;
        }
    }

    async sendAllVideos(message, article) {
        const videos = getArticleVideos(article);
        log(`🎬 Nombre de vidéos pour ${article.nom} : ${videos.length}`);
        if (!videos.length) {
            await message.reply(`Aucune vidéo disponible pour ${article.nom}.`);
            return;
        }
        await message.reply(`Vidéo de ${article.nom} :`);
        for (const vid of videos) {
            await this.sendVideo(message, article, vid);
            await wait(800);
        }
    }

    // ========== PHRASES ==========
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

    // ========== TRAITEMENT DES MESSAGES ==========
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
            // ============================================================
            // 1. DÉTECTION DES MESSAGES VOCAUX (ultra-robuste)
            // ============================================================
            let isVoice = false;

            if (message.type === 'ptt' || message.type === 'audio') {
                isVoice = true;
            }

            if (message._data) {
                if (message._data.type === 'ptt' || message._data.type === 'audio') {
                    isVoice = true;
                }
                if (message._data.mimetype && message._data.mimetype.startsWith('audio/')) {
                    isVoice = true;
                }
            }

            if (message.hasMedia && message.media) {
                if (message.media.mimetype && message.media.mimetype.startsWith('audio/')) {
                    isVoice = true;
                }
                if (message.media.filename) {
                    const ext = message.media.filename.toLowerCase().split('.').pop();
                    if (['ogg', 'mp3', 'm4a', 'opus', 'wav'].includes(ext)) {
                        isVoice = true;
                    }
                }
            }

            if (!isVoice && message.hasMedia && !message.body) {
                isVoice = true;
            }

            if (isVoice) {
                log(`🎤 Message vocal détecté (type: ${message.type}, hasMedia: ${message.hasMedia})`, 'INFO');
                await message.reply(
                    `Je vous remercie pour votre message vocal. Toutefois, pour un traitement plus rapide et précis, je vous invite à formuler votre demande par écrit. Cela me permettra de mieux vous orienter vers nos produits. Merci de votre compréhension.`
                );
                return;
            }

            // ============================================================
            // 2. SALUTATIONS / MERCI / AU REVOIR
            // ============================================================
            if (['bonjour', 'salut', 'hello', 'hi', 'bonsoir'].some(s => msgLower.includes(s))) {
                await message.reply(this.getIntro());
                return;
            }

            if (msgLower.includes('merci')) {
                await message.reply(`Avec plaisir. N'hésitez pas si vous avez d'autres questions.`);
                return;
            }

            if (msgLower.includes('au revoir') || msgLower.includes('a plus') || msgLower.includes('bye')) {
                await message.reply(`Au revoir, à bientôt chez Au Pays Des Senteurs.`);
                return;
            }

            // ============================================================
            // 3. RECADRAGE HORS SUJET
            // ============================================================
            const horsSujet = ['amour', 'relation', 'sexe', 'coucher', 'sortir', 'rendez-vous', 'mariage'];
            if (horsSujet.some(m => msgLower.includes(m)) &&
                !msgLower.includes('produit') && !msgLower.includes('bien-etre')) {
                await message.reply(this.getRecadrage());
                return;
            }

            // ============================================================
            // 3bis. DÉTECTION DES DEMANDES GÉNÉRIQUES DE PRODUITS
            // ============================================================
            const genericProductPhrases = [
                'puis-je avoir plus d\'information sur votre produit',
                'plus d\'infos sur le produit',
                'informations produit',
                'détails sur le produit',
                'en savoir plus sur le produit',
                'plus d\'information sur le produit',
                'info produit',
                'produit info',
                'renseignement produit'
            ];
            if (genericProductPhrases.some(phrase => msgLower.includes(phrase))) {
                await message.reply(
                    `Je ne vois pas bien l'image du produit dont vous parlez. Pouvez-vous écrire le nom du produit pour que je puisse mieux vous servir ? Merci.`
                );
                return;
            }

            // ============================================================
            // 4. GESTION DES ÉTATS DE COLLECTE D'INFOS (nom, commune/ville, numéro)
            // ============================================================
            if (this.userStates.has(sender)) {
                const state = this.userStates.get(sender);
                const response = msgLower;
                if (response === 'non' || response === 'annuler' || response === 'stop' || response === 'annulation') {
                    this.userStates.delete(sender);
                    this.pendingOrders.delete(sender);
                    await message.reply(`Commande annulée. N'hésitez pas si vous souhaitez commander un autre produit.`);
                    return;
                }
                const order = state.command;
                if (state.step === 'nom') {
                    order.clientFullName = msg;
                    state.step = 'commune';
                    await message.reply(`Merci ${msg}. Quelle est votre commune ou ville de résidence ?`);
                    return;
                } else if (state.step === 'commune') {
                    order.commune = msg;
                    state.step = 'numero';
                    await message.reply(`Quel est votre numéro de téléphone ? (ex: 07 77 60 29 77)`);
                    return;
                } else if (state.step === 'numero') {
                    order.numero = msg;
                    const total = order.article.prix * order.quantite;
                    this.saveOrder({
                        client: sender,
                        clientName: order.clientFullName,
                        commune: order.commune,
                        numero: order.numero,
                        produit: order.article.nom,
                        quantite: order.quantite,
                        total: total,
                        message: order.message,
                        date: new Date().toISOString()
                    });
                    const notif = `Nouvelle commande\nClient : ${order.clientFullName}\nCommune/Ville : ${order.commune}\nTéléphone : ${order.numero}\nProduit : ${order.article.nom}\nQuantité : ${order.quantite}\nTotal : ${total.toLocaleString()} FCFA\nMessage : "${order.message}"`;
                    try {
                        await this.client.sendMessage(`${this.config.MY_PERSONAL_NUMBER}@c.us`, notif);
                        log(`Notification envoyée à ${this.config.MY_PERSONAL_NUMBER}`);
                    } catch (notifErr) {
                        log(`Échec d'envoi de la notification: ${notifErr.message}`, 'ERROR');
                    }
                    await message.reply(`Commande confirmée et enregistrée. Merci ! Un conseiller vous contactera au ${this.config.CONTACT_PHONE} pour la livraison.`);
                    this.userStates.delete(sender);
                    this.pendingOrders.delete(sender);

                    // Demander si le client souhaite autre chose
                    await message.reply(`Souhaitez-vous autre chose ? (répondez par oui ou non)`);
                    return;
                }
            }

            // ============================================================
            // 5. COMMANDES INTERNES
            // ============================================================

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

            // IMAGES / PHOTOS
            if (msgLower.startsWith('images ') || msgLower === 'images' ||
                msgLower.startsWith('photo ') || msgLower === 'photo' ||
                msgLower.startsWith('photos ') || msgLower === 'photos') {
                let query = '';
                if (msgLower.startsWith('images ')) query = msg.substring(7);
                else if (msgLower.startsWith('photo ')) query = msg.substring(6);
                else if (msgLower.startsWith('photos ')) query = msg.substring(7);
                else query = '';
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
            if (msgLower.startsWith('video ') || msgLower === 'video' ||
                msgLower.startsWith('vidéo ') || msgLower === 'vidéo') {
                let query = '';
                if (msgLower.startsWith('video ')) query = msg.substring(6);
                else if (msgLower.startsWith('vidéo ')) query = msg.substring(6);
                else query = '';
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

            // ============================================================
            // 6. GESTION DE LA COMMANDE (détection renforcée)
            // ============================================================
            const commandKeywords = ['commande', 'commander', 'je prends', 'je veux', 'acheter', 'reserver'];
            const isCommand = commandKeywords.some(kw => msgLower.includes(kw)) &&
                !msgLower.includes('prix') &&
                !msgLower.includes('info') &&
                !msgLower.includes('catalogue');

            if (isCommand) {
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
                const reponse = `Commande enregistrée.\nProduit : ${article.nom}\nQuantité : ${quantite}\nTotal : ${total.toLocaleString()} FCFA\n${this.getConfirmation()}`;
                await message.reply(reponse);

                this.pendingOrders.set(sender, { article, quantite, total, clientName: senderName, message: msg });
                log(`[DEBUG] Commande stockée dans pendingOrders pour ${senderName}`, 'DEBUG');
                return;
            }

            // ============================================================
            // 7. CONFIRMATION DE COMMANDE (reconnaissance étendue)
            // ============================================================
            if (this.isConfirmation(msg)) {
                log(`[DEBUG] Confirmation reçue. pendingOrders contient : ${this.pendingOrders.has(sender) ? 'OUI' : 'NON'}`, 'DEBUG');
                if (this.pendingOrders.has(sender)) {
                    const order = this.pendingOrders.get(sender);
                    this.userStates.set(sender, { step: 'nom', command: order });
                    await message.reply(`Merci pour votre commande. Pour la livraison, quel est votre nom complet ?`);
                } else {
                    await message.reply(`S'il vous plaît, pouvez bien reformuler votre demande ? J'ai pas bien saisi ou bien voulez passer une commande maintenant ?`);
                }
                return;
            }

            if (msgLower === 'non' || msgLower === 'n') {
                if (this.pendingOrders.has(sender)) {
                    this.pendingOrders.delete(sender);
                    if (this.userStates.has(sender)) this.userStates.delete(sender);
                    await message.reply(`Commande annulée.`);
                } else {
                    await message.reply(`Vous n'avez pas de commande en attente. Si vous souhaitez commander, dites "je commande [produit]".`);
                }
                return;
            }

            // ============================================================
            // 8. GESTION DE "SOUHAITEZ-VOUS AUTRE CHOSE ?"
            // ============================================================
            if (this.userStates.has(sender) && this.userStates.get(sender).step === 'fin') {
                const response = msgLower;
                if (this.isConfirmation(response)) {
                    this.userStates.delete(sender);
                    await message.reply(`Parfait ! Que souhaitez-vous commander d'autre ? Dites-moi le produit.`);
                    return;
                } else if (response === 'non' || response === 'n') {
                    this.userStates.delete(sender);
                    await message.reply(`Nous vous remercions pour votre commande. Prenez soin de vous et à la prochaine ! 🙏`);
                    return;
                } else {
                    await message.reply(`Je n'ai pas bien compris. Souhaitez-vous autre chose ? (répondez par oui ou non)`);
                    return;
                }
            }

            // ============================================================
            // 9. FAQ (avant DeepSeek)
            // ============================================================
            const faqAnswer = this.handleFAQ(msg);
            if (faqAnswer) {
                await message.reply(faqAnswer);
                return;
            }

            // ============================================================
            // 10. RECHERCHE PAR CATÉGORIE
            // ============================================================
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
            // 11. APPEL À DEEPSEEK POUR TOUTE AUTRE DEMANDE
            // ============================================================
            log(`[DEBUG] Aucune correspondance FAQ, appel à DeepSeek.`);

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
                // Fallback amélioré
                await message.reply(`Je n'ai pas bien compris votre demande. Pourriez-vous reformuler ou utiliser "!catalogue" pour découvrir nos produits ?`);
            }

        } catch (err) {
            log(`Erreur: ${err.message}`);
            await message.reply(`Désolée, une erreur est survenue. Reessayez ou contactez le support au ${this.config.CONTACT_PHONE}.`);
        }
    }

    // ========== DÉMARRAGE ET RECONNEXION FORCÉE ==========
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