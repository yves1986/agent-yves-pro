const axios = require('axios');
const { log } = require('./utils');

class IAService {
    constructor(apiKey, apiUrl) {
        this.apiKey = apiKey;
        this.apiUrl = apiUrl || 'https://api.deepseek.com/v1/chat/completions';
        this.maxRetries = 2;
        this.retryDelay = 1000;
    }

    async getResponse(userMessage, catalogueContext, history = []) {
        log(`[DeepSeek] Appel avec message: "${userMessage.substring(0, 40)}..."`);

        if (!this.apiKey) {
            log('[DeepSeek] Clé API manquante !', 'ERROR');
            return null;
        }

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                const systemPrompt = `Tu es KADI, conseillère chez Au Pays Des Senteurs.
- Réponds de manière brève, naturelle, sans émojis.
- Si la demande est ambiguë (plusieurs produits possibles), demande des précisions en listant les options.
- Pour un produit, donne le prix et une brève description.
- Pour une commande, demande confirmation.
- Catalogue: ${catalogueContext}`;

                const messages = [{ role: 'system', content: systemPrompt }];
                const recent = history.slice(-8);
                for (const m of recent) messages.push(m);
                messages.push({ role: 'user', content: userMessage });

                const response = await axios.post(this.apiUrl, {
                    model: 'deepseek-chat',
                    messages: messages,
                    temperature: 0.6,
                    max_tokens: 150,
                    stream: false
                }, {
                    headers: {
                        'Authorization': 'Bearer ' + this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });

                const content = response.data.choices[0].message.content;
                log(`[DeepSeek] Réponse: "${content.substring(0, 50)}..."`);
                return content;

            } catch (error) {
                log(`[DeepSeek] Tentative ${attempt + 1} échouée: ${error.message}`, 'ERROR');
                if (error.response) {
                    log(`[DeepSeek] Status: ${error.response.status} - ${JSON.stringify(error.response.data)}`, 'ERROR');
                }
                if (attempt < this.maxRetries - 1) {
                    await new Promise(r => setTimeout(r, this.retryDelay));
                }
            }
        }

        log('[DeepSeek] Échec après toutes les tentatives', 'ERROR');
        return null;
    }
}

module.exports = IAService;