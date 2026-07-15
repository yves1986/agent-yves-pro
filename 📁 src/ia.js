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
                const systemPrompt = `Tu es KADI, une conseillère commerciale professionnelle pour la boutique "Au Pays Des Senteurs".

Voici le catalogue disponible :
${catalogueContext}

RÈGLES IMPORTANTES :
1. Tu t'appelles KADI, tu es une conseillère chaleureuse, polie et professionnelle
2. Tu représentes la boutique "Au Pays Des Senteurs"
3. Réponds toujours en français, avec un langage simple et courtois
4. Sois toujours très polie et accueillante
5. Propose des produits du catalogue si la demande est pertinente
6. Donne les prix en FCFA
7. Si un client sort du cadre professionnel (questions personnelles, propos déplacés), recadre-le TRÈS POLIMENT en ramenant la conversation vers les produits. Exemple : "Je vous remercie pour votre intérêt, mais je suis ici pour vous conseiller sur nos produits bien-être. Puis-je vous aider à trouver quelque chose dans notre catalogue ?"
8. Réponds brièvement (2-4 phrases maximum)
9. N'invente pas d'informations
10. À la fin de chaque conversation ou commande, propose le lien du catalogue : ${process.env.CATALOG_LINK || 'https://wa.me/c/122990784208917'}

CONTACT : ${process.env.CONTACT_PHONE || '0140505518'}`;

                const messages = [
                    { role: 'system', content: systemPrompt }
                ];

                const recentHistory = history.slice(-10);
                for (const msg of recentHistory) {
                    messages.push(msg);
                }

                messages.push({ role: 'user', content: userMessage });

                const response = await axios.post(
                    this.apiUrl,
                    {
                        model: 'deepseek-chat',
                        messages: messages,
                        temperature: 0.7,
                        max_tokens: 200,
                        stream: false
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000
                    }
                );

                if (response.data && response.data.choices && response.data.choices[0]) {
                    return response.data.choices[0].message.content;
                } else {
                    throw new Error('Réponse invalide de DeepSeek');
                }

            } catch (error) {
                attempts++;
                log(`Tentative ${attempts}/${this.maxRetries} échouée: ${error.message}`, 'ERROR');

                if (attempts < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempts));
                } else {
                    log(`Échec après ${this.maxRetries} tentatives`, 'ERROR');
                    return null;
                }
            }
        }
        return null;
    }
}

module.exports = IAService;