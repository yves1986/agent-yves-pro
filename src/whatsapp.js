const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const chromium = require('@sparticuz/chromium');
const {
    log, getImagePath, getVideoPath, fileExists, normalizeText,
    getArticleImages, getArticleVideos, wait, listFiles, toWhatsAppId
} = require('./utils');

const CONFIRM_RE = /^(oui|ok|okay|d'accord|daccord|dac|yes|yep|yeah|ouais|je confirme|confirme|confirmer|c'est confirm[ée]|c'est bon|je le veux|valide|valider)\b/i;
const NEGATIVE_RE = /^(non|n|nan|no|annuler|annule|annulation|stop|pas maintenant|laisse|laissez)\b/i;
const CANCEL_RE = /^(non|annuler|annule|annulation|stop)$/i;
const GREETING_RE = /^(bonjour|bonsoir|salut|hello|hi|coucou|bjr|bsr|cc)\b/i;
const THANKS_RE = /^(merci|merci beaucoup|thanks|ok merci|d'accord merci)\b/i;
const BYE_RE = /^(au revoir|a plus|à plus|bye|a bientot|à bientôt|bonne nuit)\b/i;
const ORDER_RE = /\b(je commande|commander|je prends|je veux|je voudrais|j'aimerais|acheter|j'ach[eè]te|r[ée]server|livrez|livrer)\b/i;
const QUESTION_RE = /\?|combien|\bprix\b|c'est quoi|comment|\binfos?\b|catalogue|photo|image|vid[ée]o|savoir|conseil/i;

class WhatsAppService {
    constructor(config, catalogue, iaService, knowledge) {
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
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 20;
        this.keepAliveInterval = null;
        this.checkInterval = null;

        this.memoryPath = path.join(__dirname, '../data/memory.json');
        this.ordersPath = path.join(__dirname, '../data/orders.json');
        this.sessionPath = path.join(__dirname, '../.wwebjs_auth');

        this.storeName = 'Au Pays Des Senteurs';
        this.adminId = toWhatsAppId(config.MY_PERSONAL_NUMBER);
        this.client = null;

        this.knowledge = knowledge || { general_faq: [], products: {} };

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
        log(`Dossier images : ${imageDir} - ${listFiles(imageDir).length} fichiers`);
        log(`Dossier vidéos : ${videoDir} - ${listFiles(videoDir).length} fichiers`);
        if (listFiles(imageDir).length === 0) {
            log('Aucun fichier image trouvé ! Vérifiez que les fichiers sont bien dans media/images/.', 'WARNING');
        }
    }

    // ========== FAQ (réponses fixes issues de knowledge_base.json) ==========
    static questionMatches(msgLower, question) {
        const q = question.toLowerCase();
        if (msgLower.includes(q)) return true;
        // Correspondance inverse seulement pour des messages assez longs ("prix" seul ne doit pas déclencher une FAQ).
        return msgLower.length >= 12 && q.includes(msgLower);
    }

    handleFAQ(userMessage) {
        const msgLower = userMessage.toLowerCase().trim();
        const kb = this.knowledge;

        const entrepriseKeywords = ['votre entreprise', 'votre boutique', 'votre société', 'qui êtes-vous', 'qui etes vous', 'à propos', 'a propos de vous', 'en savoir plus sur vous'];
        if (entrepriseKeywords.some(kw => msgLower.includes(kw))) {
            return "Au Pays Des Senteurs est une boutique spécialisée dans les produits de bien-être et de la pharmacopée traditionnelle ivoirienne. Nous proposons des encens, des aphrodisiaques, des soins et bien d'autres produits naturels. Tapez !catalogue pour voir nos produits ou posez-moi une question précise.";
        }

        for (const item of kb.general_faq || []) {
            if (WhatsAppService.questionMatches(msgLower, item.question)) return item.answer;
        }

        const products = kb.products || {};
        for (const product of Object.values(products)) {
            for (const item of [...(product.faq_specific || []), ...(product.general_faq || [])]) {
                if (WhatsAppService.questionMatches(msgLower, item.question)) return item.answer;
            }
        }

        // Fiche produit (hors encens) quand le client cite un produit sans intention de commande
        for (const [key, product] of Object.entries(products)) {
            if (key === 'encens') continue;
            if (product.name && msgLower.includes(product.name.toLowerCase())) {
                let answer = `*${product.name}*\nPrix : ${product.price} FCFA\nIndications : ${product.indications}\n`;
                if (product.dosage) {
                    if (typeof product.dosage === 'object') {
                        answer += 'Posologie :\n';
                        for (const [k, v] of Object.entries(product.dosage)) answer += `   - ${k} : ${v}\n`;
                    } else {
                        answer += `Posologie : ${product.dosage}\n`;
                    }
                }
                if (product.duration) answer += `Durée : ${product.duration}\n`;
                if (product.contre_indications) answer += `Contre-indications : ${product.contre_indications}\n`;
                answer += `\nSouhaitez-vous commander ? Écrivez par exemple "je commande 1 ${product.name}".`;
                return answer;
            }
        }

        const encensList = products.encens?.list || [];
        for (const encens of encensList) {
            if (msgLower.includes(encens.name.toLowerCase())) {
                return `*Encens ${encens.name}*\nPrix : ${encens.price} FCFA\nUtilisation : ${encens.type}\n\nSouhaitez-vous le commander ? Écrivez par exemple "je commande 1 encens ${encens.name}".`;
            }
        }

        // "encens" seul (pas "encensoir")
        if (/\bencens\b/.test(msgLower) && encensList.length) {
            let answer = 'Nos encens disponibles :\n\n';
            encensList.forEach(e => { answer += `- ${e.name} : ${e.price} FCFA (${e.type})\n`; });
            answer += '\nQuel encens vous intéresse ? Je peux vous donner plus de détails.';
            return answer;
        }

        return null;
    }

    // ========== DÉTECTION DE COMMANDE ==========
    isConfirmation(text) { return CONFIRM_RE.test(text.trim()); }
    isNegative(text) { return NEGATIVE_RE.test(text.trim()); }

    hasOrderIntent(text) {
        if (ORDER_RE.test(text)) return !QUESTION_RE.test(text) || /je commande/i.test(text);
        return /^\d{1,3}\s+\S/.test(text.trim()); // "2 encens sarakatane"
    }

    // Quantité = premier nombre qui ne fait pas partie d'un nom de produit ("30 Min de Silence").
    extractQuantity(text) {
        const re = /\b(\d{1,3})\b(?!\s*(?:min|minutes)\b)/gi;
        const match = re.exec(text);
        const q = match ? parseInt(match[1], 10) : 1;
        return q > 0 && q <= 100 ? q : 1;
    }

    getNaturalPrompt() {
        const phrases = [
            "D'accord, pourriez-vous préciser le produit et la quantité ? Par exemple : \"je commande 2 Encens Sarakatane\".",
            'Je vous écoute, quel produit souhaitez-vous commander, et en quelle quantité ?',
            'Pas de problème, dites-moi simplement le produit et la quantité.'
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getCatalogLink() {
        return this.config.CATALOG_LINK;
    }

    // ========== CLIENT WHATSAPP ==========
    async resolveChromePath() {
        if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
        if (process.platform === 'linux') return chromium.executablePath();
        const candidates = process.platform === 'win32'
            ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
            : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
        const found = candidates.find(p => fs.existsSync(p));
        if (!found) throw new Error('Chrome introuvable : définissez PUPPETEER_EXECUTABLE_PATH');
        return found;
    }

    async createClient() {
        const executablePath = await this.resolveChromePath();
        const args = process.platform === 'linux' ? chromium.args : [];
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
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
            log('QR Code généré');
            console.log('\nScannez ce QR Code avec WhatsApp :');
            qrcode.generate(qr, { small: true });
            console.log(`\nOu ouvrez ce lien : ${qrUrl}`);
            console.log('En attente de connexion...\n');
            try { fs.writeFileSync(path.join(__dirname, '../qr.txt'), qr); } catch (e) { }
        });

        // On n'active l'agent qu'à l'événement "ready" (après "authenticated" le client n'est pas encore utilisable).
        this.client.on('authenticated', () => log('Authentification réussie'));

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
            log(`Échec auth: ${msg}`, 'ERROR');
            this.isReady = false;
            await this.handleReconnection();
        });

        this.client.on('disconnected', async (reason) => {
            log(`Déconnecté: ${reason}`, 'WARNING');
            this.isReady = false;
            if (reason !== 'LOGOUT') {
                await this.handleReconnection();
            } else {
                log('Déconnexion volontaire (LOGOUT) - pas de reconnexion automatique');
            }
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
                log(`Erreur non gérée dans handleMessage: ${err.message}`, 'ERROR');
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

    // Un seul cycle de reconnexion à la fois (les événements disconnected/error/watchdog peuvent arriver ensemble).
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
            const delay = Math.min(15000 * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
            log(`Attente de ${delay / 1000}s avant reconnexion`, 'RECONNECT');
            await wait(delay);
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
                log('Watchdog: agent non prêt, tentative de reconnexion...', 'WATCHDOG');
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

    // ========== PERSISTANCE ==========
    loadMemory() {
        if (fs.existsSync(this.memoryPath)) {
            try { this.memory = JSON.parse(fs.readFileSync(this.memoryPath, 'utf8')); } catch (e) { this.memory = {}; }
        }
    }

    saveMemory() {
        try { fs.writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2)); } catch (e) { }
    }

    remember(sender, userText, assistantText) {
        if (!this.memory[sender]) this.memory[sender] = [];
        this.memory[sender].push({ role: 'user', content: userText }, { role: 'assistant', content: assistantText });
        if (this.memory[sender].length > 20) this.memory[sender] = this.memory[sender].slice(-20);
        this.saveMemory();
    }

    readOrders() {
        if (!fs.existsSync(this.ordersPath)) return [];
        try { return JSON.parse(fs.readFileSync(this.ordersPath, 'utf8')); } catch (e) { return []; }
    }

    saveOrder(order) {
        const orders = this.readOrders();
        orders.push(order);
        try {
            fs.writeFileSync(this.ordersPath, JSON.stringify(orders, null, 2));
        } catch (err) {
            log(`Impossible d'enregistrer la commande: ${err.message}`, 'ERROR');
        }
        log(`Nouvelle commande: ${order.produit} x ${order.quantite}`);
    }

    // ========== ENVOI D'IMAGES ET VIDÉOS ==========
    async sendMediaFile(message, article, filePath, caption, kind) {
        if (!fileExists(filePath)) {
            log(`${kind} manquante : ${filePath}`, 'ERROR');
            await message.reply(`La ${kind} de ${article.nom} n'est pas encore disponible.`);
            return false;
        }
        try {
            const media = MessageMedia.fromFilePath(filePath);
            await message.reply(media, undefined, { caption });
            return true;
        } catch (err) {
            log(`Erreur envoi ${kind}: ${err.message}`, 'ERROR');
            await message.reply(`Je n'arrive pas à envoyer la ${kind} pour le moment. En attendant, consultez notre catalogue : ${this.getCatalogLink()}`);
            return false;
        }
    }

    async sendAllImages(message, article) {
        const images = getArticleImages(article);
        if (!images.length) {
            await message.reply(`Aucune photo disponible pour ${article.nom}. Consultez notre catalogue : ${this.getCatalogLink()}`);
            return;
        }
        await message.reply(`Voici les photos de ${article.nom} :`);
        for (const img of images) {
            await this.sendMediaFile(message, article, getImagePath(img), article.nom, 'photo');
            await wait(500);
        }
    }

    async sendAllVideos(message, article) {
        const videos = getArticleVideos(article);
        if (!videos.length) {
            await message.reply(`Aucune vidéo disponible pour ${article.nom}.`);
            return;
        }
        await message.reply(`Vidéo de ${article.nom} :`);
        for (const vid of videos) {
            await this.sendMediaFile(message, article, getVideoPath(vid), `${article.nom} (vidéo)`, 'vidéo');
            await wait(800);
        }
    }

    // ========== PHRASES ==========
    getIntro() {
        const phrases = [
            "Bonjour, c'est KADI de la boutique Au Pays Des Senteurs. Comment puis-je vous aider ?",
            'Bonjour et bienvenue chez Au Pays Des Senteurs. Je suis KADI, votre conseillère. Que recherchez-vous ?',
            'Bonjour, je vous souhaite une bonne journée. Ici KADI, votre conseillère en produits bien-être. Comment puis-je vous aider ?'
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getConfirmation() {
        const phrases = [
            'Vous confirmez cette commande ? (oui / non)',
            'Voulez-vous valider cette commande ? (oui / non)'
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    // Prépare une commande en attente de confirmation.
    async proposeOrder(message, sender, senderName, article, quantite, originalMsg) {
        const total = (article.prix || 0) * quantite;
        this.pendingOrders.set(sender, { article, quantite, total, clientName: senderName, message: originalMsg });
        this.lastArticleByUser.set(sender, article);
        await message.reply(`Récapitulatif de votre commande :\nProduit : ${article.nom}\nQuantité : ${quantite}\nTotal : ${total.toLocaleString('fr-FR')} FCFA\n${this.getConfirmation()}`);
    }

    // ========== ÉTAPES DE LIVRAISON (nom → commune → téléphone → fin) ==========
    async handleUserState(message, sender, msg) {
        const state = this.userStates.get(sender);

        if (state.step === 'fin') {
            this.userStates.delete(sender);
            if (this.isConfirmation(msg)) {
                await message.reply("Parfait ! Que souhaitez-vous commander d'autre ? Dites-moi le produit et la quantité.");
                return true;
            }
            if (this.isNegative(msg)) {
                await message.reply('Nous vous remercions pour votre commande. Prenez soin de vous et à bientôt chez Au Pays Des Senteurs !');
                return true;
            }
            return false; // autre message : on le traite normalement
        }

        if (CANCEL_RE.test(msg.trim())) {
            this.userStates.delete(sender);
            this.pendingOrders.delete(sender);
            await message.reply(`Commande annulée. N'hésitez pas si un autre produit vous intéresse : ${this.getCatalogLink()}`);
            return true;
        }

        const order = state.command;
        if (state.step === 'nom') {
            order.clientFullName = msg;
            state.step = 'commune';
            await message.reply(`Merci ${msg}. Quelle est votre commune ou ville de résidence ?`);
            return true;
        }
        if (state.step === 'commune') {
            order.commune = msg;
            state.step = 'numero';
            await message.reply('Quel est votre numéro de téléphone ? (ex : 07 77 60 29 77)');
            return true;
        }
        if (state.step === 'numero') {
            if (msg.replace(/\D/g, '').length < 8) {
                await message.reply("Ce numéro ne semble pas valide. Pouvez-vous me l'écrire à nouveau ? (ex : 07 77 60 29 77)");
                return true;
            }
            order.numero = msg;
            this.saveOrder({
                client: sender,
                clientName: order.clientFullName,
                commune: order.commune,
                numero: order.numero,
                produit: order.article.nom,
                quantite: order.quantite,
                total: order.total,
                message: order.message,
                date: new Date().toISOString()
            });
            const notif = `Nouvelle commande\nClient : ${order.clientFullName}\nCommune/Ville : ${order.commune}\nTéléphone : ${order.numero}\nWhatsApp : ${sender.replace('@c.us', '')}\nProduit : ${order.article.nom}\nQuantité : ${order.quantite}\nTotal : ${order.total.toLocaleString('fr-FR')} FCFA\nMessage : "${order.message}"`;
            if (this.adminId) {
                try {
                    await this.client.sendMessage(this.adminId, notif);
                    log(`Notification envoyée à ${this.adminId}`);
                } catch (notifErr) {
                    log(`Échec d'envoi de la notification: ${notifErr.message}`, 'ERROR');
                }
            }
            this.pendingOrders.delete(sender);
            this.userStates.set(sender, { step: 'fin' });
            await message.reply(`Commande confirmée et enregistrée. Merci ! Un conseiller vous contactera pour la livraison (contact : ${this.config.CONTACT_PHONE}).\n\nSouhaitez-vous autre chose ? (oui / non)`);
            return true;
        }
        return false;
    }

    // ========== TRAITEMENT DES MESSAGES ==========
    async handleMessage(message) {
        if (message.fromMe) return;
        if (message.from.endsWith('@g.us') || message.from === 'status@broadcast' || message.isStatus) return;
        if (this.processedMessages.has(message.id.id)) return;
        this.processedMessages.add(message.id.id);
        setTimeout(() => this.processedMessages.delete(message.id.id), 60000);

        const msg = message.body ? message.body.trim() : '';
        const sender = message.from;
        const senderName = message._data?.notifyName || 'Client';
        const msgLower = msg.toLowerCase();

        log(`Message de ${senderName} [${message.type}]: ${msg.substring(0, 50)}`);

        try {
            // 1. Vocaux et médias
            if (message.type === 'ptt' || message.type === 'audio') {
                await message.reply('Merci pour votre message vocal. Pour mieux vous servir, pouvez-vous écrire votre demande ?');
                return;
            }
            if (['image', 'video', 'sticker', 'document'].includes(message.type) && !msg) {
                await message.reply("Merci pour votre envoi. Je ne peux pas bien voir l'image : pouvez-vous écrire le nom du produit qui vous intéresse ?");
                return;
            }
            if (!msg) return;

            // 2. Étapes de livraison en cours
            if (this.userStates.has(sender) && await this.handleUserState(message, sender, msg)) return;

            // 3. Commande admin
            if (msgLower === '!commandes' && sender === this.adminId) {
                const orders = this.readOrders();
                if (!orders.length) {
                    await message.reply('Aucune commande enregistrée.');
                    return;
                }
                let reponse = 'Dernières commandes :\n\n';
                orders.slice(-10).reverse().forEach((o, i) => {
                    reponse += `${i + 1}. ${o.clientName} (${o.commune || '?'}, ${o.numero || '?'})\n   ${o.produit} x ${o.quantite} = ${Number(o.total || 0).toLocaleString('fr-FR')} FCFA\n   ${new Date(o.date).toLocaleString('fr-FR')}\n\n`;
                });
                await message.reply(reponse);
                return;
            }

            // 4. Commandes internes
            if (msgLower === '!catalogue' || msgLower === '!cat') {
                const categoriesCount = this.catalogue.getCategoriesWithCount();
                let reponse = 'Catalogue Au Pays Des Senteurs\n\n';
                for (const [cat, count] of Object.entries(categoriesCount)) {
                    if (count > 0) {
                        reponse += `${cat} (${count} produit${count > 1 ? 's' : ''})\n`;
                        const items = this.catalogue.articles.filter(a => a.categorie === cat && a.disponible);
                        items.slice(0, 5).forEach(a => {
                            reponse += `  - ${a.nom} : ${a.prix ? a.prix.toLocaleString('fr-FR') : 'N/A'} FCFA\n`;
                        });
                        if (items.length > 5) reponse += `  ... et ${items.length - 5} autre(s)\n`;
                        reponse += '\n';
                    }
                }
                reponse += `Pour plus d'infos : "info [nom]". Pour commander : "je commande [quantité] [nom]".\nCatalogue en ligne : ${this.getCatalogLink()}`;
                await message.reply(reponse);
                return;
            }

            if (msgLower === '!categories' || msgLower === '!catégories') {
                const categoriesCount = this.catalogue.getCategoriesWithCount();
                let reponse = 'Catégories :\n';
                for (const [cat, count] of Object.entries(categoriesCount)) {
                    if (count > 0) reponse += `- ${cat} (${count} article${count > 1 ? 's' : ''})\n`;
                }
                await message.reply(reponse);
                return;
            }

            if (msgLower === '!aide' || msgLower === '!help') {
                await message.reply(`Commandes :
- !catalogue : voir tous les produits
- !categories : voir les catégories
- info [nom] : détails d'un produit
- images [nom] : photos
- video [nom] : vidéo
- contact : coordonnées
- je commande [quantité] [nom] : passer commande`);
                return;
            }

            if (msgLower === '!contact' || msgLower === 'contact') {
                await message.reply(`Contact : ${this.config.CONTACT_PHONE}\nCatalogue : ${this.getCatalogLink()}`);
                return;
            }

            // Photos / vidéos : "images X", "photo X", "video X" ; sans nom → dernier produit consulté
            // (en début de message, ou n'importe où si un produit précis est cité : "envoyez-moi la photo du kit homme")
            let mediaMatch = msg.match(/^(images?|photos?|vid[ée]os?)\b\s*(.*)$/i);
            if (!mediaMatch) {
                const inner = msg.match(/\b(images?|photos?|vid[ée]os?)\b/i);
                if (inner && this.catalogue.search(msg).length === 1) mediaMatch = [msg, inner[1], msg];
            }
            if (mediaMatch) {
                const isVideo = /^vid/i.test(mediaMatch[1]);
                const query = mediaMatch[2].trim();
                const article = query ? this.catalogue.search(query)[0] : this.lastArticleByUser.get(sender);
                if (!article) {
                    await message.reply(query ? `Aucun produit trouvé pour "${query}".` : `Précisez le produit, par exemple : "${isVideo ? 'video' : 'images'} Encens Sarakatane".`);
                    return;
                }
                this.lastArticleByUser.set(sender, article);
                if (isVideo) await this.sendAllVideos(message, article);
                else await this.sendAllImages(message, article);
                return;
            }

            // Info / prix
            const infoMatch = msg.match(/^(info|infos|prix)\s+(.+)$/i);
            if (infoMatch) {
                const query = infoMatch[2];
                const results = this.catalogue.search(query);
                if (!results.length) {
                    await message.reply(`Je n'ai pas trouvé "${query}". Consultez notre catalogue : ${this.getCatalogLink()}`);
                } else if (results.length === 1) {
                    await message.reply(`${this.catalogue.formatArticle(results[0])}\n\nSouhaitez-vous le commander ?`);
                    this.lastArticleByUser.set(sender, results[0]);
                } else {
                    await message.reply(this.catalogue.formatList(results, 'Résultats'));
                }
                return;
            }

            // 5. Réponse à une commande en attente de confirmation
            if (this.pendingOrders.has(sender)) {
                if (this.isConfirmation(msg)) {
                    const order = this.pendingOrders.get(sender);
                    this.userStates.set(sender, { step: 'nom', command: order });
                    await message.reply('Merci pour votre commande. Pour la livraison, quel est votre nom complet ?');
                    return;
                }
                if (this.isNegative(msg)) {
                    this.pendingOrders.delete(sender);
                    await message.reply(`Commande annulée. D'autres produits pourraient vous intéresser : ${this.getCatalogLink()}`);
                    return;
                }
            }

            // 6. Nouvelle commande ("je commande 2 encens sarakatane", "2 kit homme")
            if (this.hasOrderIntent(msg)) {
                const quantite = this.extractQuantity(msg);
                const results = this.catalogue.search(msg);
                if (results.length === 1) {
                    await this.proposeOrder(message, sender, senderName, results[0], quantite, msg);
                    return;
                }
                if (results.length > 1) {
                    const options = results.slice(0, 8).map(a => `- ${a.nom} : ${a.prix.toLocaleString('fr-FR')} FCFA`).join('\n');
                    await message.reply(`Plusieurs produits correspondent :\n${options}\n\nLequel souhaitez-vous ? Écrivez par exemple "je commande ${quantite} ${results[0].nom}".`);
                    return;
                }
                const last = this.lastArticleByUser.get(sender);
                if (last && /\b(le|la|ce|cet|cette|ça|ca|celui)\b/i.test(msg)) {
                    await this.proposeOrder(message, sender, senderName, last, quantite, msg);
                    return;
                }
                await message.reply(this.getNaturalPrompt());
                return;
            }

            // 7. Salutations / remerciements / au revoir (messages courts uniquement)
            const shortMsg = msg.split(/\s+/).length <= 4;
            if (shortMsg && GREETING_RE.test(msg)) {
                await message.reply(this.getIntro());
                return;
            }
            if (shortMsg && THANKS_RE.test(msg)) {
                await message.reply(`Avec plaisir. N'hésitez pas si vous avez d'autres questions, ou consultez notre catalogue : ${this.getCatalogLink()}`);
                return;
            }
            if (shortMsg && BYE_RE.test(msg)) {
                await message.reply('Au revoir, à bientôt chez Au Pays Des Senteurs.');
                return;
            }

            // 8. FAQ fixe
            const faqAnswer = this.handleFAQ(msg);
            if (faqAnswer) {
                await message.reply(faqAnswer);
                return;
            }

            // 9. Catégorie citée seule ("aphrodisiaque", "encensoirs")
            const normalizedMsg = normalizeText(msg);
            // Mot entier, singulier ou pluriel ("encensoir" ≠ catégorie "Encens")
            const catMatch = (this.catalogue.categories || []).find(c => {
                const base = normalizeText(c).replace(/\s+/g, ' ').trim().replace(/s$/, '');
                return new RegExp(`\\b${base}s?\\b`).test(normalizedMsg);
            });
            if (catMatch && shortMsg) {
                const results = this.catalogue.searchByCategory(catMatch);
                if (results.length) {
                    await message.reply(this.catalogue.formatList(results, `Catégorie ${catMatch}`));
                    return;
                }
            }

            // 10. Claude pour tout le reste
            const iaResponse = await this.iaService.getResponse(msg, this.memory[sender] || []);
            if (iaResponse) {
                await message.reply(iaResponse);
                this.remember(sender, msg, iaResponse);
                const mentioned = this.catalogue.articles.find(a => a.disponible && iaResponse.includes(a.nom));
                if (mentioned) this.lastArticleByUser.set(sender, mentioned);
            } else {
                await message.reply(`Je n'ai pas bien compris votre demande. Pourriez-vous reformuler, ou consulter notre catalogue : ${this.getCatalogLink()}`);
            }
        } catch (err) {
            log(`Erreur: ${err.stack || err.message}`, 'ERROR');
            await message.reply(`Toutes mes excuses, je ne peux pas répondre pour le moment. Appelez-moi directement au ${this.config.CONTACT_PHONE}.`).catch(() => { });
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
        this.reconnectAttempts = 0;
        await this.handleReconnection();
    }

    getState() {
        return this.isReady ? 'connected' : 'disconnected';
    }
}

module.exports = WhatsAppService;
