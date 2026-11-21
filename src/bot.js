// Cerveau de KADI : reçoit un message texte normalisé et renvoie les réponses à envoyer.
// Indépendant du transport (WhatsApp Web ou API WhatsApp Cloud).
const { log, normalizeText, toWhatsAppId } = require('./utils');

const CONFIRM_RE = /^(oui|ok|okay|d'accord|daccord|dac|yes|yep|yeah|ouais|je confirme|confirme|confirmer|c'est confirm[ée]|c'est bon|je le veux|valide|valider)\b/i;
const NEGATIVE_RE = /^(non|n|nan|no|annuler|annule|annulation|stop|pas maintenant|laisse|laissez)\b/i;
const CANCEL_RE = /^(non|annuler|annule|annulation|stop)$/i;
const GREETING_RE = /^(bonjour|bonsoir|salut|hello|hi|coucou|bjr|bsr|cc)\b/i;
const THANKS_RE = /^(merci|merci beaucoup|thanks|ok merci|d'accord merci)\b/i;
const BYE_RE = /^(au revoir|a plus|à plus|bye|a bientot|à bientôt|bonne nuit)\b/i;
const ORDER_RE = /\b(je commande|commander|je prends|je veux|je voudrais|j'aimerais|acheter|j'ach[eè]te|r[ée]server|livrez|livrer)\b/i;
const QUESTION_RE = /\?|combien|\bprix\b|c'est quoi|comment|\binfos?\b|catalogue|photo|image|vid[ée]o|savoir|conseil/i;

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;

class KadiBot {
    /**
     * @param {object} deps
     * @param {object} deps.config     { CONTACT_PHONE, MY_PERSONAL_NUMBER, CATALOG_LINK }
     * @param {object} deps.catalogue  Instance de Catalogue
     * @param {object} deps.ia         Instance d'IAService (getResponse)
     * @param {object} deps.knowledge  Contenu de knowledge_base.json
     * @param {object} deps.store      MemoryStore ou RedisStore
     */
    constructor({ config, catalogue, ia, knowledge, store, hasMedia }) {
        this.hasMedia = hasMedia || (() => true); // (kind, fichier) => le média existe-t-il ?
        this.config = config;
        this.catalogue = catalogue;
        this.ia = ia;
        this.knowledge = knowledge || { general_faq: [], products: {} };
        this.store = store;
        this.adminId = toWhatsAppId(config.MY_PERSONAL_NUMBER);
        this.adminDigits = this.adminId ? this.adminId.replace('@c.us', '') : null;
    }

    get catalogLink() { return this.config.CATALOG_LINK; }

    isAdmin(user) { return !!this.adminDigits && String(user).replace(/\D/g, '') === this.adminDigits; }

    /**
     * @param {object} input
     * @param {string} input.user   Numéro de l'expéditeur (chiffres, avec ou sans @c.us)
     * @param {string} input.name   Nom WhatsApp affiché
     * @param {string} input.type   text | audio | image | video | sticker | document | autre
     * @param {string} input.text   Texte ou légende
     * @returns {Promise<{replies: Array, notifications: Array}>}
     *   replies : { kind: 'text', text } | { kind: 'image'|'video', file, caption }
     *   notifications : { to: numéro admin (chiffres), text }
     */
    async handle({ user, name, type, text }) {
        const out = { replies: [], notifications: [] };
        const say = (t) => out.replies.push({ kind: 'text', text: t });
        const msg = (text || '').trim();
        const session = await this.store.getSession(user);

        try {
            await this.route({ user, name: name || 'Client', type, msg, session, say, out });
        } catch (err) {
            log(`Erreur bot: ${err.stack || err.message}`, 'ERROR');
            out.replies = [{ kind: 'text', text: `Toutes mes excuses, je ne peux pas répondre pour le moment. Appelez-moi directement au ${this.config.CONTACT_PHONE}.` }];
        }

        await this.store.saveSession(user, session);
        return out;
    }

    async route({ user, name, type, msg, session, say, out }) {
        const msgLower = msg.toLowerCase();

        // 1. Vocaux et médias
        if (type === 'audio' || type === 'ptt') {
            say('Merci pour votre message vocal. Pour mieux vous servir, pouvez-vous écrire votre demande ?');
            return;
        }
        if (['image', 'video', 'sticker', 'document'].includes(type) && !msg) {
            say("Merci pour votre envoi. Je ne peux pas bien voir l'image : pouvez-vous écrire le nom du produit qui vous intéresse ?");
            return;
        }
        if (!msg) return;

        // 2. Étapes de livraison en cours
        if (session.state && await this.handleDeliveryStep({ user, msg, session, say, out })) return;

        // 3. Commande admin
        if (msgLower === '!commandes' && this.isAdmin(user)) {
            const orders = await this.store.listOrders(10);
            if (!orders.length) { say('Aucune commande enregistrée.'); return; }
            let r = 'Dernières commandes :\n\n';
            orders.forEach((o, i) => {
                r += `${i + 1}. ${o.clientName} (${o.commune || '?'}, ${o.numero || '?'})\n   ${o.produit} x ${o.quantite} = ${fcfa(o.total)}\n   ${new Date(o.date).toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' })}\n\n`;
            });
            say(r);
            return;
        }

        // 4. Commandes internes
        if (msgLower === '!catalogue' || msgLower === '!cat') { say(this.catalogueText()); return; }

        if (msgLower === '!categories' || msgLower === '!catégories') {
            let r = 'Catégories :\n';
            for (const [cat, count] of Object.entries(this.catalogue.getCategoriesWithCount())) {
                if (count > 0) r += `- ${cat} (${count} article${count > 1 ? 's' : ''})\n`;
            }
            say(r);
            return;
        }

        if (msgLower === '!aide' || msgLower === '!help') {
            say(`Commandes :
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
            say(`Contact : ${this.config.CONTACT_PHONE}\nCatalogue : ${this.catalogLink}`);
            return;
        }

        // Photos / vidéos : "images X", "video X", ou "envoyez-moi la photo du kit homme"
        let mediaMatch = msg.match(/^(images?|photos?|vid[ée]os?)\b\s*(.*)$/i);
        if (!mediaMatch) {
            const inner = msg.match(/\b(images?|photos?|vid[ée]os?)\b/i);
            if (inner && this.catalogue.search(msg).length === 1) mediaMatch = [msg, inner[1], msg];
        }
        if (mediaMatch) {
            const isVideo = /^vid/i.test(mediaMatch[1]);
            const query = mediaMatch[2].trim();
            const article = query ? this.catalogue.search(query)[0] : this.catalogue.getById(session.lastArticleId);
            if (!article) {
                say(query ? `Aucun produit trouvé pour "${query}".` : `Précisez le produit, par exemple : "${isVideo ? 'video' : 'images'} Encens Sarakatane".`);
                return;
            }
            session.lastArticleId = article.id;
            this.addMedia(out, article, isVideo);
            return;
        }

        // Info / prix
        const infoMatch = msg.match(/^(info|infos|prix)\s+(.+)$/i);
        if (infoMatch) {
            const results = this.catalogue.search(infoMatch[2]);
            if (!results.length) say(`Je n'ai pas trouvé "${infoMatch[2]}". Consultez notre catalogue : ${this.catalogLink}`);
            else if (results.length === 1) {
                say(`${this.catalogue.formatArticle(results[0])}\n\nSouhaitez-vous le commander ?`);
                session.lastArticleId = results[0].id;
            } else say(this.catalogue.formatList(results, 'Résultats'));
            return;
        }

        // 5. Réponse à une commande en attente de confirmation
        if (session.pending) {
            if (CONFIRM_RE.test(msg)) {
                session.state = { step: 'nom', order: session.pending };
                delete session.pending;
                say('Merci pour votre commande. Pour la livraison, quel est votre nom complet ?');
                return;
            }
            if (NEGATIVE_RE.test(msg)) {
                delete session.pending;
                say(`Commande annulée. D'autres produits pourraient vous intéresser : ${this.catalogLink}`);
                return;
            }
        }

        // 6. Nouvelle commande ("je commande 2 encens sarakatane", "2 kit homme")
        if (this.hasOrderIntent(msg)) {
            const quantite = this.extractQuantity(msg);
            const results = this.catalogue.search(msg);
            if (results.length === 1) { this.proposeOrder(session, say, name, results[0], quantite, msg); return; }
            if (results.length > 1) {
                const options = results.slice(0, 8).map(a => `- ${a.nom} : ${fcfa(a.prix)}`).join('\n');
                say(`Plusieurs produits correspondent :\n${options}\n\nLequel souhaitez-vous ? Écrivez par exemple "je commande ${quantite} ${results[0].nom}".`);
                return;
            }
            const last = this.catalogue.getById(session.lastArticleId);
            if (last && /\b(le|la|ce|cet|cette|ça|ca|celui)\b/i.test(msg)) { this.proposeOrder(session, say, name, last, quantite, msg); return; }
            say(pick([
                "D'accord, pourriez-vous préciser le produit et la quantité ? Par exemple : \"je commande 2 Encens Sarakatane\".",
                'Je vous écoute, quel produit souhaitez-vous commander, et en quelle quantité ?',
                'Pas de problème, dites-moi simplement le produit et la quantité.'
            ]));
            return;
        }

        // 7. Salutations / remerciements / au revoir (messages courts uniquement)
        const shortMsg = msg.split(/\s+/).length <= 4;
        if (shortMsg && GREETING_RE.test(msg)) {
            say(pick([
                "Bonjour, c'est KADI de la boutique Au Pays Des Senteurs. Comment puis-je vous aider ?",
                'Bonjour et bienvenue chez Au Pays Des Senteurs. Je suis KADI, votre conseillère. Que recherchez-vous ?',
                'Bonjour, je vous souhaite une bonne journée. Ici KADI, votre conseillère en produits bien-être. Comment puis-je vous aider ?'
            ]));
            return;
        }
        if (shortMsg && THANKS_RE.test(msg)) { say(`Avec plaisir. N'hésitez pas si vous avez d'autres questions, ou consultez notre catalogue : ${this.catalogLink}`); return; }
        if (shortMsg && BYE_RE.test(msg)) { say('Au revoir, à bientôt chez Au Pays Des Senteurs.'); return; }

        // 8. FAQ fixe
        const faq = this.handleFAQ(msg);
        if (faq) { say(faq); return; }

        // 9. Catégorie citée ("aphrodisiaque", "encensoirs"), mot entier
        const normalizedMsg = normalizeText(msg);
        const catMatch = (this.catalogue.categories || []).find(c => {
            const base = normalizeText(c).replace(/\s+/g, ' ').trim().replace(/s$/, '');
            return new RegExp(`\\b${base}s?\\b`).test(normalizedMsg);
        });
        if (catMatch && shortMsg) {
            const results = this.catalogue.searchByCategory(catMatch);
            if (results.length) { say(this.catalogue.formatList(results, `Catégorie ${catMatch}`)); return; }
        }

        // 10. Claude pour tout le reste
        const answer = await this.ia.getResponse(msg, session.history || []);
        if (answer) {
            say(answer);
            session.history = [...(session.history || []), { role: 'user', content: msg }, { role: 'assistant', content: answer }].slice(-20);
            const mentioned = this.catalogue.articles.find(a => a.disponible && answer.includes(a.nom));
            if (mentioned) session.lastArticleId = mentioned.id;
        } else {
            say(`Je n'ai pas bien compris votre demande. Pourriez-vous reformuler, ou consulter notre catalogue : ${this.catalogLink}`);
        }
    }

    // ========== COMMANDES ==========
    hasOrderIntent(text) {
        if (ORDER_RE.test(text)) return !QUESTION_RE.test(text) || /je commande/i.test(text);
        return /^\d{1,3}\s+\S/.test(text.trim());
    }

    // Premier nombre qui ne fait pas partie d'un nom de produit ("30 Min de Silence")
    extractQuantity(text) {
        const match = /\b(\d{1,3})\b(?!\s*(?:min|minutes)\b)/i.exec(text);
        const q = match ? parseInt(match[1], 10) : 1;
        return q > 0 && q <= 100 ? q : 1;
    }

    proposeOrder(session, say, clientName, article, quantite, message) {
        const total = (article.prix || 0) * quantite;
        session.pending = { articleId: article.id, produit: article.nom, quantite, total, clientName, message };
        session.lastArticleId = article.id;
        say(`Récapitulatif de votre commande :\nProduit : ${article.nom}\nQuantité : ${quantite}\nTotal : ${fcfa(total)}\n${pick(['Vous confirmez cette commande ? (oui / non)', 'Voulez-vous valider cette commande ? (oui / non)'])}`);
    }

    // Étapes nom → commune → téléphone → "autre chose ?"
    async handleDeliveryStep({ user, msg, session, say, out }) {
        const state = session.state;

        if (state.step === 'fin') {
            delete session.state;
            if (CONFIRM_RE.test(msg)) { say("Parfait ! Que souhaitez-vous commander d'autre ? Dites-moi le produit et la quantité."); return true; }
            if (NEGATIVE_RE.test(msg)) { say('Nous vous remercions pour votre commande. Prenez soin de vous et à bientôt chez Au Pays Des Senteurs !'); return true; }
            return false; // autre message : traité normalement
        }

        if (CANCEL_RE.test(msg)) {
            delete session.state;
            say(`Commande annulée. N'hésitez pas si un autre produit vous intéresse : ${this.catalogLink}`);
            return true;
        }

        const order = state.order;
        if (state.step === 'nom') {
            order.clientFullName = msg;
            state.step = 'commune';
            say(`Merci ${msg}. Quelle est votre commune ou ville de résidence ?`);
            return true;
        }
        if (state.step === 'commune') {
            order.commune = msg;
            state.step = 'numero';
            say('Quel est votre numéro de téléphone ? (ex : 07 77 60 29 77)');
            return true;
        }
        if (state.step === 'numero') {
            if (msg.replace(/\D/g, '').length < 8) {
                say("Ce numéro ne semble pas valide. Pouvez-vous me l'écrire à nouveau ? (ex : 07 77 60 29 77)");
                return true;
            }
            const whatsapp = String(user).replace('@c.us', '');
            await this.store.addOrder({
                client: whatsapp,
                clientName: order.clientFullName,
                commune: order.commune,
                numero: msg,
                produit: order.produit,
                quantite: order.quantite,
                total: order.total,
                message: order.message,
                date: new Date().toISOString()
            });
            log(`Nouvelle commande: ${order.produit} x ${order.quantite}`);
            if (this.adminDigits) {
                out.notifications.push({
                    to: this.adminDigits,
                    text: `Nouvelle commande\nClient : ${order.clientFullName}\nCommune/Ville : ${order.commune}\nTéléphone : ${msg}\nWhatsApp : ${whatsapp}\nProduit : ${order.produit}\nQuantité : ${order.quantite}\nTotal : ${fcfa(order.total)}\nMessage : "${order.message}"`
                });
            }
            session.state = { step: 'fin' };
            say(`Commande confirmée et enregistrée. Merci ! Un conseiller vous contactera pour la livraison (contact : ${this.config.CONTACT_PHONE}).\n\nSouhaitez-vous autre chose ? (oui / non)`);
            return true;
        }
        return false;
    }

    // ========== CONTENUS ==========
    catalogueText() {
        let r = 'Catalogue Au Pays Des Senteurs\n\n';
        for (const [cat, count] of Object.entries(this.catalogue.getCategoriesWithCount())) {
            if (count <= 0) continue;
            r += `${cat} (${count} produit${count > 1 ? 's' : ''})\n`;
            const items = this.catalogue.articles.filter(a => a.categorie === cat && a.disponible);
            items.slice(0, 5).forEach(a => { r += `  - ${a.nom} : ${a.prix ? fcfa(a.prix) : 'N/A'}\n`; });
            if (items.length > 5) r += `  ... et ${items.length - 5} autre(s)\n`;
            r += '\n';
        }
        return `${r}Pour plus d'infos : "info [nom]". Pour commander : "je commande [quantité] [nom]".\nCatalogue en ligne : ${this.catalogLink}`;
    }

    addMedia(out, article, isVideo) {
        const kind = isVideo ? 'video' : 'image';
        const files = ((isVideo ? article.videos : article.images) || []).filter(f => this.hasMedia(kind, f));
        if (!files.length) {
            out.replies.push({ kind: 'text', text: isVideo ? `Aucune vidéo disponible pour ${article.nom}.` : `Aucune photo disponible pour ${article.nom}. Consultez notre catalogue : ${this.catalogLink}` });
            return;
        }
        out.replies.push({ kind: 'text', text: isVideo ? `Vidéo de ${article.nom} :` : `Voici les photos de ${article.nom} :` });
        for (const file of files) {
            out.replies.push({ kind: isVideo ? 'video' : 'image', file, caption: isVideo ? `${article.nom} (vidéo)` : article.nom });
        }
    }

    static questionMatches(msgLower, question) {
        const q = question.toLowerCase();
        if (msgLower.includes(q)) return true;
        return msgLower.length >= 12 && q.includes(msgLower); // "prix" seul ne déclenche pas une FAQ
    }

    handleFAQ(userMessage) {
        const msgLower = userMessage.toLowerCase().trim();
        const kb = this.knowledge;

        const entreprise = ['votre entreprise', 'votre boutique', 'votre société', 'qui êtes-vous', 'qui etes vous', 'à propos', 'a propos de vous', 'en savoir plus sur vous'];
        if (entreprise.some(kw => msgLower.includes(kw))) {
            return "Au Pays Des Senteurs est une boutique spécialisée dans les produits de bien-être et de la pharmacopée traditionnelle ivoirienne. Nous proposons des encens, des aphrodisiaques, des soins et bien d'autres produits naturels. Tapez !catalogue pour voir nos produits ou posez-moi une question précise.";
        }

        for (const item of kb.general_faq || []) {
            if (KadiBot.questionMatches(msgLower, item.question)) return item.answer;
        }

        const products = kb.products || {};
        for (const product of Object.values(products)) {
            for (const item of [...(product.faq_specific || []), ...(product.general_faq || [])]) {
                if (KadiBot.questionMatches(msgLower, item.question)) return item.answer;
            }
        }

        for (const [key, product] of Object.entries(products)) {
            if (key === 'encens' || !product.name || !msgLower.includes(product.name.toLowerCase())) continue;
            let answer = `*${product.name}*\nPrix : ${product.price} FCFA\nIndications : ${product.indications}\n`;
            if (product.dosage) {
                if (typeof product.dosage === 'object') {
                    answer += 'Posologie :\n';
                    for (const [k, v] of Object.entries(product.dosage)) answer += `   - ${k} : ${v}\n`;
                } else answer += `Posologie : ${product.dosage}\n`;
            }
            if (product.duration) answer += `Durée : ${product.duration}\n`;
            if (product.contre_indications) answer += `Contre-indications : ${product.contre_indications}\n`;
            return `${answer}\nSouhaitez-vous commander ? Écrivez par exemple "je commande 1 ${product.name}".`;
        }

        const encensList = products.encens?.list || [];
        for (const e of encensList) {
            if (msgLower.includes(e.name.toLowerCase())) {
                return `*Encens ${e.name}*\nPrix : ${e.price} FCFA\nUtilisation : ${e.type}\n\nSouhaitez-vous le commander ? Écrivez par exemple "je commande 1 encens ${e.name}".`;
            }
        }

        if (/\bencens\b/.test(msgLower) && encensList.length) {
            let answer = 'Nos encens disponibles :\n\n';
            encensList.forEach(e => { answer += `- ${e.name} : ${e.price} FCFA (${e.type})\n`; });
            return `${answer}\nQuel encens vous intéresse ? Je peux vous donner plus de détails.`;
        }
        return null;
    }
}

module.exports = KadiBot;
