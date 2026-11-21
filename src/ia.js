const sdk = require('@anthropic-ai/sdk');
const { log } = require('./utils');

const Anthropic = sdk.Anthropic || sdk.default || sdk;

// Modèles qui acceptent le repli serveur `fallbacks: "default"` (beta) et ceux qui acceptent `output_config.effort`.
const MODELS_WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-fable-5-2']);
const MODELS_WITH_EFFORT = new Set([...MODELS_WITH_FALLBACK, 'claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7']);

class IAService {
    /**
     * @param {object} opts
     * @param {string} opts.apiKey        Clé API Anthropic (ANTHROPIC_API_KEY)
     * @param {string} [opts.model]       Modèle Claude (CLAUDE_MODEL), défaut claude-opus-5-5
     * @param {object} opts.catalogue     Instance de Catalogue
     * @param {object} [opts.knowledge]   Contenu de data/knowledge_base.json
     * @param {string} opts.contactPhone
     * @param {string} opts.catalogLink
     */
    constructor({ apiKey, model, catalogue, knowledge, contactPhone, catalogLink }) {
        this.model = model || 'claude-opus-5-5';
        this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
        this.catalogue = catalogue;
        this.knowledge = knowledge || {};
        this.contactPhone = contactPhone;
        this.catalogLink = catalogLink;
        this.systemPrompt = this.buildSystemPrompt();
    }

    // Prompt système stable (mis en cache côté Anthropic) : persona + catalogue + base de connaissances.
    buildSystemPrompt() {
        const catalogue = this.catalogue.articles
            .filter(a => a.disponible)
            .map(a => `- ${a.nom} (${a.categorie}) : ${a.prix ? a.prix.toLocaleString('fr-FR') : 'prix sur demande'} FCFA. ${a.description || ''}`)
            .join('\n');

        return `Tu es KADI, conseillère commerciale de la boutique "Au Pays Des Senteurs" (Côte d'Ivoire), spécialisée dans les produits de bien-être et la pharmacopée traditionnelle ivoirienne. Tu réponds aux clients sur WhatsApp.

Style :
- Réponds en français, de façon brève (2 à 4 phrases), chaleureuse, polie et naturelle, sans émojis ni mise en forme Markdown.
- Donne les prix en FCFA. N'invente jamais de produit, de prix, d'effet ou d'information absente du catalogue ou de la base de connaissances ci-dessous. Si tu ne sais pas, propose d'appeler le ${this.contactPhone}.
- Après avoir donné un prix, demande si le client souhaite commander.
- Pour commander, le client doit écrire : "je commande [quantité] [nom du produit]" (exemple : "je commande 2 Encens Sarakatane"). C'est le système qui enregistre la commande, toi tu ne confirmes jamais une commande toi-même.
- Si la demande est ambiguë (plusieurs produits possibles), liste les options et demande de préciser.
- Les produits aphrodisiaques et de santé intime font partie du catalogue : réponds-y de façon professionnelle et pudique. Si le client sort du cadre commercial (drague, propos déplacés, sujets sans rapport), ramène poliment la conversation vers les produits.
- Pour les questions médicales sérieuses, rappelle les contre-indications connues et conseille de consulter un professionnel de santé.
- Commandes utiles à indiquer si besoin : "!catalogue", "info [nom]", "images [nom]", "video [nom]". Catalogue en ligne : ${this.catalogLink}

Catalogue disponible :
${catalogue}

Base de connaissances (FAQ, indications, posologies, livraison, paiement) :
${JSON.stringify(this.knowledge)}`;
    }

    // L'historique doit commencer par un message "user" et ne contenir que du texte non vide.
    sanitizeHistory(history) {
        const clean = (history || [])
            .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
            .slice(-10);
        while (clean.length && clean[0].role !== 'user') clean.shift();
        return clean;
    }

    async getResponse(userMessage, history = []) {
        const messages = [...this.sanitizeHistory(history), { role: 'user', content: userMessage }];
        const useBetaFeatures = MODELS_WITH_FALLBACK.has(this.model);

        const params = {
            model: this.model,
            max_tokens: 2048,
            system: [{ type: 'text', text: this.systemPrompt, cache_control: { type: 'ephemeral' } }],
            messages
        };
        if (MODELS_WITH_EFFORT.has(this.model)) {
            params.output_config = { effort: 'low' }; // conversation commerciale : réponses rapides et économiques
        }
        if (useBetaFeatures) {
            params.betas = ['server-side-fallback-2026-07-01'];
            params.fallbacks = 'default'; // repli automatique si le modèle refuse la requête
        }

        try {
            const response = useBetaFeatures
                ? await this.client.beta.messages.create(params)
                : await this.client.messages.create(params);

            if (response.stop_reason === 'refusal') {
                log(`[Claude] Refus (${response.stop_details?.category || 'inconnu'})`, 'WARNING');
                return null;
            }

            const text = response.content
                .filter(b => b.type === 'text')
                .map(b => b.text)
                .join('\n')
                .trim();

            log(`[Claude] Réponse (${response.usage?.input_tokens ?? '?'} in / ${response.usage?.cache_read_input_tokens ?? 0} cache / ${response.usage?.output_tokens ?? '?'} out): "${text.substring(0, 60)}"`);
            return text || null;
        } catch (error) {
            if (error instanceof Anthropic.AuthenticationError) {
                log('[Claude] Clé API invalide (ANTHROPIC_API_KEY)', 'ERROR');
            } else if (error instanceof Anthropic.RateLimitError) {
                log('[Claude] Limite de débit atteinte', 'ERROR');
            } else if (error instanceof Anthropic.APIError) {
                log(`[Claude] Erreur API ${error.status}: ${error.message}`, 'ERROR');
            } else {
                log(`[Claude] Erreur: ${error.message}`, 'ERROR');
            }
            return null;
        }
    }
}

module.exports = IAService;
