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
                const systemPrompt = `Tu es Agent Yves, un conseiller commercial professionnel.
Voici le catalogue disponible :
${catalogueContext}

Règles :
- Réponds toujours en français
- Sois courtois et professionnel
- Propose des articles du catalogue si la demande est pertinente
- Donne les prix en FCFA
- Pour les demandes de renseignements, oriente vers le contact ${process.env.CONTACT_PHONE || '0140505518'}
- Réponds brièvement (2-4 phrases maximum)
- N'invente pas d'informations`;

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
                log(`Tentative ${attempts}/${this.maxRetries} échouée: ${error.message}`, 'IA_ERROR');

                if (attempts < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempts));
                } else {
                    log(`Échec après ${this.maxRetries} tentatives`, 'IA_FATAL');
                    return null;
                }
            }
        }
        return null;
    }
}

module.exports = IAService;