const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const {
    log,
    getImagePath,
    getVideoPath,
    fileExists,
    getArticleImages,
    getArticleVideos,
    wait
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

        this.catalogLink = process.env.CATALOG_LINK || 'https://wa.me/c/122990784208917';
        this.storeName = "Au Pays Des Senteurs";

        this.ensureDirectories();
        this.client = this.createClient();
        this.setupEvents();
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
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                log(`Dossier créé: ${dir}`, 'INFO');
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
        this.client.on('qr', qr => {
            log('📱 QR Code généré - Scannez avec WhatsApp', 'INFO');
            console.log('\n📱 SCANNEZ CE QR CODE :');
            qrcode.generate(qr, { small: true });
            console.log('\n⏳ En attente de connexion...\n');

            try {
                fs.writeFileSync(path.join(__dirname, '../qr.txt'), qr);
            } catch (err) { }
        });

        this.client.on('authenticated', () => {
            this.isReady = true;
            this.reconnectAttempts = 0;
            log('🔐 Authentification réussie', 'SUCCESS');
        });

        this.client.on('ready', () => {
            this.isReady = true;
            this.isInitialized = true;
            this.reconnectAttempts = 0;
            this.loadMemory();
            log('✅ AGENT KADI ACTIF 24/7', 'READY');
            console.log(`🏪 ${this.storeName}`);
            console.log(`📞 ${this.config.CONTACT_PHONE}`);
            console.log(`📦 ${this.catalogue.articles.length} articles chargés`);
            console.log(`📸 ${this.catalogue.articles.filter(a => a.images?.length > 0).length} avec images`);
            console.log(`🎬 ${this.catalogue.articles.filter(a => a.videos?.length > 0).length} avec vidéos`);
            console.log(`🔗 Catalogue: ${this.catalogLink}`);
            console.log('\n💡 Commandes: !catalogue, !categories, info [nom], images [nom], video [nom]');
            console.log('🔄 Tourne sur Render - 24/7\n');
        });

        this.client.on('auth_failure', async (msg) => {
            log(`Échec d'authentification: ${msg}`, 'ERROR');
            this.isReady = false;
            await this.handleReconnection();
        });

        this.client.on('disconnected', async (reason) => {
            log(`Déconnecté: ${reason}`, 'WARNING');
            this.isReady = false;

            if (reason !== 'LOGOUT') {
                await this.handleReconnection();
            }
        });

        this.client.on('error', async (error) => {
            log(`Erreur client: ${error.message}`, 'ERROR');
            if (error.message.includes('TIMEOUT') ||
                error.message.includes('closed') ||
                error.message.includes('Session') ||
                error.message.includes('browser')) {
                await this.handleReconnection();
            }
        });

        this.client.on('message', async message => {
            if (this.isReady) {
                await this.handleMessage(message);
            }
        });

        this.client.on('change_state', (state) => {
            log(`État changé: ${state}`, 'INFO');
            if (state === 'CONFLICT' || state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') {
                this.isReady = false;
                this.handleReconnection();
            }
        });
    }

    // ========== RECONNEXION ==========
    async handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            log(`Trop de tentatives (${this.maxReconnectAttempts})`, 'FATAL');
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

            log('✅ Reconnexion réussie', 'SUCCESS');
            this.reconnectAttempts = 0;
        } catch (err) {
            log(`Échec reconnexion: ${err.message}`, 'ERROR');
            setTimeout(() => this.handleReconnection(), 30000);
        }
    }

    // ========== KEEP ALIVE ==========
    setupKeepAlive() {
        this.keepAliveInterval = setInterval(() => {
            if (this.isReady && this.client) {
                try {
                    if (this.client.pupPage) {
                        this.client.pupPage.evaluate(() => 'keep-alive').catch(() => { });
                    }
                } catch (err) { }
            }
        }, 30000);

        this.checkInterval = setInterval(async () => {
            if (!this.isReady && this.isInitialized) {
                log('Watchdog: Agent non prêt, reconnexion...', 'WARNING');
                await this.handleReconnection();
            }

            if (this.isReady) {
                try {
                    const state = await this.client.getState().catch(() => null);
                    if (state !== 'CONNECTED') {
                        log(`État anormal: ${state}`, 'WARNING');
                        this.isReady = false;
                        await this.handleReconnection();
                    }
                } catch (err) {
                    log(`Erreur vérification état: ${err.message}`, 'ERROR');
                    this.isReady = false;
                    await this.handleReconnection();
                }
            }
        }, 120000);
    }

    // ========== MÉMOIRE ==========
    loadMemory() {
        if (fs.existsSync(this.memoryPath)) {
            try {
                this.memory = JSON.parse(fs.readFileSync(this.memoryPath, 'utf8'));
                log(`${Object.keys(this.memory).length} clients en mémoire`, 'INFO');
            } catch (err) {
                this.memory = {};
            }
        }
    }

    saveMemory() {
        try {
            fs.writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2));
        } catch (err) { }
    }

    // ========== COMMANDES ==========
    saveOrder(order) {
        let orders = [];
        if (fs.existsSync(this.ordersPath)) {
            try {
                orders = JSON.parse(fs.readFileSync(this.ordersPath, 'utf8'));
            } catch (err) { }
        }
        orders.push(order);
        fs.writeFileSync(this.ordersPath, JSON.stringify(orders, null, 2));
        log(`📦 Nouvelle commande: ${order.produit} x ${order.quantite}`, 'SUCCESS');
    }

    // ========== MÉDIAS ==========
    async sendImage(message, article, imageName) {
        const imagePath = getImagePath(imageName);

        if (!fileExists(imagePath)) {
            await message.reply(`📸 Je suis désolée, l'image de ${article.nom} n'est pas disponible pour le moment.`);
            log(`Image manquante: ${imagePath}`, 'WARNING');
            return false;
        }

        try {
            const media = MessageMedia.fromFilePath(imagePath);
            await message.reply(media, undefined, {
                caption: `📸 ${article.nom} - ${this.storeName}`
            });
            return true;
        } catch (err) {
            log(`Erreur envoi image: ${err.message}`, 'ERROR');
            return false;
        }
    }

    async sendVideo(message, article, videoName) {
        const videoPath = getVideoPath(videoName);

        if (!fileExists(videoPath)) {
            await message.reply(`🎬 Je suis désolée, la vidéo de ${article.nom} n'est pas disponible pour le moment.`);
            log(`Vidéo manquante: ${videoPath}`, 'WARNING');
            return false;
        }

        try {
            const media = MessageMedia.fromFilePath(videoPath);
            await message.reply(media, undefined, {
                caption: `🎬 ${article.nom} (5 secondes) - ${this.storeName}`
            });
            return true;
        } catch (err) {
            log(`Erreur envoi vidéo: ${err.message}`, 'ERROR');
            return false;
        }
    }

    async sendAllImages(message, article) {
        const images = getArticleImages(article);

        if (!images || images.length === 0) {
            await message.reply(`📸 Je suis désolée, je n'ai pas de photos de ${article.nom} pour le moment.`);
            return;
        }

        await message.reply(`📸 *${images.length} photo(s) de ${article.nom}*`);

        for (const image of images) {
            await this.sendImage(message, article, image);
            await wait(1000);
        }
    }

    async sendAllVideos(message, article) {
        const videos = getArticleVideos(article);

        if (!videos || videos.length === 0) {
            await message.reply(`🎬 Je suis désolée, je n'ai pas de vidéo de ${article.nom} pour le moment.`);
            return;
        }

        await message.reply(`🎬 *${videos.length} vidéo(s) de ${article.nom}*`);

        for (const video of videos) {
            await this.sendVideo(message, article, video);
            await wait(2000);
        }
    }

    // ========== PHRASES D'INTRODUCTION POLIES ==========
    getIntroductionPhrase() {
        const phrases = [
            `Bonjour et bienvenue chez "Au Pays Des Senteurs" ! Je suis KADI, votre conseillère en produits bien-être. Comment puis-je vous aider aujourd'hui ?`,
            `Bonjour cher client ! Je suis KADI, votre conseillère de la boutique "Au Pays Des Senteurs". C'est un plaisir de vous recevoir. Que puis-je faire pour vous ?`,
            `Bonjour ! Je vous souhaite une excellente journée. Ici KADI, votre conseillère en produits bien-être de "Au Pays Des Senteurs". Comment puis-je vous assister ?`,
            `Bonjour et merci de me contacter ! Je suis KADI, de la boutique "Au Pays Des Senteurs". Je suis ravie de vous aider à découvrir nos produits.`,
            `Bonjour ! Je suis enchantée de vous accueillir chez "Au Pays Des Senteurs". KADI à votre service, que puis-je vous proposer ?`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getReponsePhrase() {
        const phrases = [
            `Avec plaisir, laissez-moi vous renseigner sur nos produits de "Au Pays Des Senteurs".`,
            `Certainement, je vous explique tout de suite. Chez "Au Pays Des Senteurs", nous avons ce qu'il vous faut.`,
            `Très bien, je vais vous donner toutes les informations sur ce produit de notre boutique.`,
            `Parfait, je suis là pour ça. "Au Pays Des Senteurs" met à votre disposition ses meilleurs conseils.`,
            `Avec grand plaisir, voici les détails de ce produit de notre collection.`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getCommandePhrase() {
        const phrases = [
            `Merci beaucoup pour votre commande chez "Au Pays Des Senteurs" !`,
            `C'est noté, merci pour votre confiance en "Au Pays Des Senteurs" !`,
            `Super ! Votre commande est bien enregistrée par "Au Pays Des Senteurs".`,
            `Excellent choix ! Je valide votre commande au nom de "Au Pays Des Senteurs".`,
            `Merci infiniment ! Je traite votre commande avec grand soin.`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getRecadragePhrase() {
        const phrases = [
            `Je vous remercie pour votre intérêt, mais je suis ici pour vous conseiller sur nos produits bien-être de "Au Pays Des Senteurs". Puis-je vous aider à trouver quelque chose dans notre catalogue ?`,
            `Je suis désolée, je ne peux pas répondre à cette question. En tant que conseillère de "Au Pays Des Senteurs", je suis spécialisée dans nos produits bien-être. Avez-vous besoin d'informations sur un produit ?`,
            `Je comprends votre curiosité, mais je suis KADI, votre conseillère en produits bien-être. Je vous invite à découvrir notre catalogue "Au Pays Des Senteurs". Que puis-je vous montrer ?`,
            `Je vous prie de m'excuser, je ne suis pas habilitée à discuter de ce sujet. Je suis là pour vous présenter les merveilleux produits de "Au Pays Des Senteurs". Souhaitez-vous voir notre catalogue ?`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    getFinPhrase() {
        const phrases = [
            `\n\n🔗 N'hésitez pas à consulter notre catalogue complet : ${this.catalogLink}`,
            `\n\n🔗 Pour découvrir tous nos produits, visitez notre catalogue : ${this.catalogLink}`,
            `\n\n🔗 Retrouvez tous nos produits sur notre catalogue : ${this.catalogLink}`,
            `\n\n🔗 Je vous invite à parcourir notre catalogue : ${this.catalogLink}`
        ];
        return phrases[Math.floor(Math.random() * phrases.length)];
    }

    // ========== TEMPS DE RÉPONSE NATUREL ==========
    async think() {
        // Délai aléatoire entre 1.5 et 4 secondes (simule une réflexion naturelle)
        const delay = 1500 + Math.random() * 2500;
        await wait(delay);
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
            // ========== TEMPS DE RÉFLEXION NATUREL ==========
            await this.think();

            // ========== SALUTATIONS ==========
            const salutations = ['bonjour', 'salut', 'coucou', 'hello', 'hi', 'bonsoir', 'bon après-midi', 'bonne journée'];
            if (salutations.some(s => msgLower.includes(s))) {
                const intro = this.getIntroductionPhrase();
                await message.reply(`👋 ${intro}`);
                return;
            }

            // ========== MERCI ==========
            if (msgLower.includes('merci') || msgLower.includes('merci beaucoup')) {
                const phrases = [
                    `😊 Avec grand plaisir ! N'hésitez pas si vous avez d'autres questions. Et n'oubliez pas de consulter notre catalogue : ${this.catalogLink}`,
                    `😊 Je suis ravie d'avoir pu vous aider ! À bientôt chez "Au Pays Des Senteurs". ${this.getFinPhrase()}`,
                    `😊 C'est un honneur de vous servir. Bonne journée ! ${this.getFinPhrase()}`
                ];
                await message.reply(phrases[Math.floor(Math.random() * phrases.length)]);
                return;
            }

            // ========== AU REVOIR ==========
            if (msgLower.includes('au revoir') || msgLower.includes('à plus') || msgLower.includes('bye') || msgLower.includes('à bientôt')) {
                const phrases = [
                    `👋 Au revoir cher client ! Prenez soin de vous. ${this.getFinPhrase()}`,
                    `👋 À très bientôt chez "Au Pays Des Senteurs" ! Je reste à votre disposition. ${this.getFinPhrase()}`,
                    `👋 Bonne journée, au plaisir de vous revoir chez "Au Pays Des Senteurs" ! ${this.getFinPhrase()}`
                ];
                await message.reply(phrases[Math.floor(Math.random() * phrases.length)]);
                return;
            }

            // ========== RECADRAGE (HORS CADRE PROFESSIONNEL) ==========
            const motsHorsCadre = ['amour', 'relation', 'sentiment', 'sexe', 'coucher', 'sortir ensemble', 'rendez-vous', 'beauté', 'jolie', 'mariage', 'femme', 'homme'];
            if (motsHorsCadre.some(m => msgLower.includes(m)) &&
                !msgLower.includes('produit') &&
                !msgLower.includes('bien-être') &&
                !msgLower.includes('encens') &&
                !msgLower.includes('parfum')) {
                const recadrage = this.getRecadragePhrase();
                await message.reply(`${recadrage}`);
                return;
            }

            // ========== COMMANDES ==========

            // !catalogue
            if (msgLower === '!catalogue' || msgLower === '!cat') {
                const intro = this.getReponsePhrase();
                const categoriesCount = this.catalogue.getCategoriesWithCount();
                let response = `${intro}
                
📦 *CATALOGUE "AU PAYS DES SENTEURS"*

`;
                for (const [cat, count] of Object.entries(categoriesCount)) {
                    if (count > 0) {
                        response += `📂 *${cat}* (${count} produit${count > 1 ? 's' : ''})\n`;
                        const items = this.catalogue.articles.filter(a =>
                            a.categorie === cat && a.disponible
                        );
                        items.slice(0, 5).forEach(a => {
                            response += `   • ${a.nom} - ${a.prix.toLocaleString()} FCFA\n`;
                        });
                        if (items.length > 5) {
                            response += `   _... et ${items.length - 5} autre(s)_\n`;
                        }
                        response += '\n';
                    }
                }
                response += `🔍 Pour plus d'infos : "info [nom]"
📸 Pour les photos : "images [nom]"
🎬 Pour la vidéo : "video [nom]"
${this.getFinPhrase()}`;
                await message.reply(response);
                return;
            }

            // !categories
            if (msgLower === '!categories' || msgLower === '!catégories') {
                const intro = this.getReponsePhrase();
                const categoriesCount = this.catalogue.getCategoriesWithCount();
                let response = `${intro}
                
📂 *CATÉGORIES DISPONIBLES*

`;
                for (const [cat, count] of Object.entries(categoriesCount)) {
                    if (count > 0) {
                        response += `📌 ${cat} (${count} produit${count > 1 ? 's' : ''})\n`;
                    }
                }
                response += `\n🔍 Tapez "!catalogue" pour voir tous les produits.`;
                await message.reply(response);
                return;
            }

            // !aide / !help
            if (msgLower === '!aide' || msgLower === '!help') {
                const intro = this.getIntroductionPhrase();
                const help = `${intro}

📖 *Commandes disponibles:*
• !catalogue - Voir tous les produits
• !categories - Voir les catégories
• info [nom] - Détails d'un produit
• prix [nom] - Prix d'un produit
• images [nom] - Voir les photos
• video [nom] - Voir la vidéo
• Je commande [nom] - Passer une commande
• contact - Coordonnées

💬 Posez-moi une question sur les produits disponibles !

🔗 Catalogue complet : ${this.catalogLink}`;
                await message.reply(help);
                return;
            }

            // contact
            if (msgLower === '!contact' || msgLower === 'contact') {
                await message.reply(`📞 *Contactez KADI :*
☎️ ${this.config.CONTACT_PHONE}
🏪 "Au Pays Des Senteurs"
🔗 ${this.catalogLink}`);
                return;
            }

            // images [nom]
            if (msgLower.startsWith('images ') || msgLower === 'images') {
                const query = msgLower === 'images' ? '' : msg.substring(7);
                let article = null;

                if (query) {
                    const results = this.catalogue.search(query);
                    if (results.length > 0) {
                        article = results[0];
                    }
                } else if (this.lastArticleByUser.has(sender)) {
                    article = this.lastArticleByUser.get(sender);
                }

                if (article) {
                    const intro = this.getReponsePhrase();
                    await message.reply(`${intro} Voici les photos de ${article.nom}.`);
                    await this.sendAllImages(message, article);
                    this.lastArticleByUser.set(sender, article);
                } else {
                    await message.reply(`🔍 Pour voir les images, tapez "images [nom du produit]".
Exemple : "images Encens Sarakatane"`);
                }
                return;
            }

            // video [nom]
            if (msgLower.startsWith('video ') || msgLower === 'video') {
                const query = msgLower === 'video' ? '' : msg.substring(6);
                let article = null;

                if (query) {
                    const results = this.catalogue.search(query);
                    if (results.length > 0) {
                        article = results[0];
                    }
                } else if (this.lastArticleByUser.has(sender)) {
                    article = this.lastArticleByUser.get(sender);
                }

                if (article) {
                    const intro = this.getReponsePhrase();
                    await message.reply(`${intro} Voici la vidéo de ${article.nom}.`);
                    await this.sendAllVideos(message, article);
                    this.lastArticleByUser.set(sender, article);
                } else {
                    await message.reply(`🔍 Pour voir les vidéos, tapez "video [nom du produit]".
Exemple : "video Encens Sarakatane"`);
                }
                return;
            }

            // info [nom] ou prix [nom]
            if (msgLower.startsWith('info ') || msgLower.startsWith('prix ')) {
                const query = msg.substring(5);
                const results = this.catalogue.search(query);

                if (results.length === 0) {
                    await message.reply(`🔍 Je suis désolée, je n'ai pas trouvé "${query}".
📖 Essayez "!catalogue" pour voir tous nos produits.
${this.getFinPhrase()}`);
                    return;
                }

                if (results.length === 1) {
                    const intro = this.getReponsePhrase();
                    await message.reply(`${intro}\n\n${this.catalogue.formatArticle(results[0])}`);
                    this.lastArticleByUser.set(sender, results[0]);
                } else {
                    await message.reply(this.catalogue.formatList(results, '🔍 Résultats de recherche'));
                }
                return;
            }

            // ========== COMMANDE / RÉSERVATION ==========
            if (msgLower.includes('commande') ||
                msgLower.includes('commander') ||
                msgLower.includes('je prends') ||
                msgLower.includes('je veux') ||
                msgLower.includes('achète') ||
                msgLower.includes('acheter') ||
                msgLower.includes('réservation') ||
                msgLower.includes('réserver')) {

                let article = null;
                let quantite = 1;

                const quantiteMatch = msg.match(/(\d+)\s*(encens|kit|poudre|miel|suppositoire|encensoir|semence|lait|cendre)/i);
                if (quantiteMatch) {
                    quantite = parseInt(quantiteMatch[1]);
                }

                const results = this.catalogue.search(msg);
                if (results.length > 0) {
                    article = results[0];
                } else if (this.lastArticleByUser.has(sender)) {
                    article = this.lastArticleByUser.get(sender);
                }

                if (article) {
                    const total = article.prix * quantite;
                    const intro = this.getCommandePhrase();

                    const reponse = `${intro}
                    
✅ *COMMANDE ENREGISTRÉE !*

📦 Produit : ${article.nom}
📦 Quantité : ${quantite}
💰 Total : ${total.toLocaleString()} FCFA
📞 Contact : ${this.config.CONTACT_PHONE}
🏪 "Au Pays Des Senteurs"

🔔 Un conseiller vous contactera sous peu pour confirmer.

⚠️ Paiement à la livraison ou par Orange Money.

Merci pour votre confiance ! 🙏
${this.getFinPhrase()}`;

                    await message.reply(reponse);

                    // Notification sur votre WhatsApp personnel
                    const notification = `🔔 *NOUVELLE COMMANDE !*

👤 Client : ${senderName}
📱 Numéro : ${sender.replace('@c.us', '')}
🏪 "Au Pays Des Senteurs"
📦 Produit : ${article.nom}
📦 Quantité : ${quantite}
💰 Total : ${total.toLocaleString()} FCFA

📝 Message : "${msg}"
📍 Livraison : À confirmer avec le client

📅 Date : ${new Date().toLocaleString()}

✅ Commande à traiter !`;

                    await this.client.sendMessage(
                        `${this.config.MY_PERSONAL_NUMBER}@c.us`,
                        notification
                    );

                    this.saveOrder({
                        client: sender,
                        clientName: senderName,
                        produit: article.nom,
                        quantite: quantite,
                        total: total,
                        message: msg,
                        date: new Date().toISOString()
                    });

                    if (!this.memory[sender]) this.memory[sender] = [];
                    this.memory[sender].push(
                        { role: 'user', content: msg },
                        { role: 'assistant', content: reponse }
                    );
                    this.saveMemory();

                    return;
                } else {
                    await message.reply(`🔍 Pour commander, précisez le produit.
Exemple : "Je commande 3 Encens Sarakatane"
Ou utilisez "info [nom]" pour voir les détails.
${this.getFinPhrase()}`);
                    return;
                }
            }

            // ========== COMMANDE ADMIN : !commandes ==========
            if (msgLower === '!commandes' && sender === `${this.config.MY_PERSONAL_NUMBER}@c.us`) {
                if (!fs.existsSync(this.ordersPath)) {
                    await message.reply('📭 Aucune commande enregistrée.');
                    return;
                }

                const orders = JSON.parse(fs.readFileSync(this.ordersPath, 'utf8'));
                if (orders.length === 0) {
                    await message.reply('📭 Aucune commande enregistrée.');
                    return;
                }

                let response = '📦 *LISTE DES COMMANDES*\n\n';
                orders.slice(-10).reverse().forEach((o, i) => {
                    response += `${i + 1}. ${o.clientName}\n`;
                    response += `   📦 ${o.produit} x ${o.quantite} = ${o.total.toLocaleString()} FCFA\n`;
                    response += `   📅 ${new Date(o.date).toLocaleString()}\n\n`;
                });

                await message.reply(response);
                return;
            }

            // ========== RECHERCHE PAR CATÉGORIE ==========
            const categories = this.catalogue.categories || [];
            const categoryMatch = categories.find(c =>
                msgLower.includes(c.toLowerCase())
            );
            if (categoryMatch) {
                const intro = this.getReponsePhrase();
                const results = this.catalogue.searchByCategory(categoryMatch);
                if (results.length > 0) {
                    await message.reply(`${intro} Voici les produits dans la catégorie "${categoryMatch}".

${this.catalogue.formatList(results, `📂 ${categoryMatch}`)}`);
                    return;
                }
            }

            // ========== IA (pour les questions générales) ==========
            const catalogueContext = this.catalogue.articles
                .filter(a => a.disponible)
                .map(a => `- ${a.nom} : ${a.prix ? a.prix.toLocaleString() : 'N/A'} FCFA (${a.categorie})`)
                .join('\n');

            const history = this.memory[sender] || [];
            const iaResponse = await this.iaService.getResponse(msg, catalogueContext, history);

            if (iaResponse) {
                // Vérifier si la réponse contient déjà une introduction
                let finalResponse = iaResponse;
                if (!iaResponse.toLowerCase().includes('au pays des senteurs')) {
                    const intro = this.getReponsePhrase();
                    finalResponse = `${intro} ${iaResponse}`;
                }
                // Ajouter le lien du catalogue si ce n'est pas déjà fait
                if (!iaResponse.includes(this.catalogLink)) {
                    finalResponse += this.getFinPhrase();
                }
                await message.reply(finalResponse);

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
                const intro = this.getIntroductionPhrase();
                await message.reply(`${intro}

🔍 Pour voir le catalogue : !catalogue
📂 Par catégorie : !categories
📸 Images : images [nom]
🎬 Vidéos : video [nom]
📦 Commande : Je commande [nom]

${this.getFinPhrase()}`);
            }
        } catch (err) {
            log(`Erreur traitement message: ${err.message}`, 'ERROR');
            await message.reply(`❌ Je suis désolée, une erreur s'est produite. Veuillez réessayer ou contacter le support au ${this.config.CONTACT_PHONE}.`);
        }
    }

    // ========== DÉMARRAGE ==========
    async start() {
        try {
            log('🚀 Démarrage de l\'agent...', 'INFO');
            await this.client.initialize();
            this.setupKeepAlive();
            log('✅ Agent initialisé', 'SUCCESS');
        } catch (err) {
            log(`Erreur démarrage: ${err.message}`, 'FATAL');
            setTimeout(() => this.start(), 10000);
        }
    }

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

    getState() {
        return this.isReady ? 'connected' : 'disconnected';
    }
}

module.exports = WhatsAppService;