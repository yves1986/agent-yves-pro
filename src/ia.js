const axios = require('axios');
const { log } = require('./utils');

class IAService {
    constructor(apiKey, apiUrl) {
        this.apiKey = apiKey;
        this.apiUrl = apiUrl || 'https://api.deepseek.com/v1/chat/completions';
        this.maxRetries = 3;
        this.retryDelay = 2000;
    }

    async getResponse(userMessage, catalogueContext, history = []) {
        let attempts = 0;
        while (attempts < this.maxRetries) {
            try {
                const systemPrompt = `Tu es KADI, conseillere commerciale pour la boutique "Au Pays Des Senteurs". 
Reponds de maniere breve, precise et naturelle, sans emojis. Propose les produits du catalogue quand c'est pertinent. 
Pour les commandes, demande confirmation : "Voulez-vous passer commande ?", "Combien de ... ?". 
Oriente vers le contact ${process.env.CONTACT_PHONE || '0505730455'}. Reste professionnelle et courtoise.
Catalogue : ${catalogueContext}`;

                const messages = [{ role: 'system', content: systemPrompt }];
                const recent = history.slice(-10);
                for (const m of recent) messages.push(m);
                messages.push({ role: 'user', content: userMessage });

                const response = await axios.post(this.apiUrl, {
                    model: 'deepseek-chat',
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 150,
                    stream: false
                }, {
                    headers: {
                        'Authorization': 'Bearer ' + this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });
                if (response.data?.choices?.[0]) {
                    return response.data.choices[0].message.content;
                }
                throw new Error('Reponse invalide');
            } catch (error) {
                attempts++;
                log(`Tentative ${attempts}/${this.maxRetries} echouee: ${error.message}`);
                if (attempts < this.maxRetries) await wait(this.retryDelay * attempts);
                else log(`Echec apres ${this.maxRetries} tentatives`);
            }
        }
        return null;
    }
}

module.exports = IAService;