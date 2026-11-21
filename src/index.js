require('dotenv').config();
const express = require('express');
const Catalogue = require('./catalogue');
const IAService = require('./ia');
const WhatsAppService = require('./whatsapp');
const { log } = require('./utils');

const config = {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_API_URL: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
    CONTACT_PHONE: process.env.CONTACT_PHONE || '0505730455',
    MY_PERSONAL_NUMBER: process.env.MY_PERSONAL_NUMBER || '0778602977',
    PORT: process.env.PORT || 3000
};

if (!config.DEEPSEEK_API_KEY) {
    log('ERREUR: DEEPSEEK_API_KEY manquante', 'FATAL');
    process.exit(1);
}

log(`Clé API DeepSeek ${config.DEEPSEEK_API_KEY ? 'PRÉSENTE ✅' : 'MANQUANTE ❌'}`);
log('AGENT KADI - DÉMARRAGE');

const catalogue = new Catalogue();
const iaService = new IAService(config.DEEPSEEK_API_KEY, config.DEEPSEEK_API_URL);
const whatsapp = new WhatsAppService(config, catalogue, iaService);

const app = express();

app.get('/health', (req, res) => {
    res.json({
        status: whatsapp.getState(),
        connected: whatsapp.getState() === 'connected',
        store: 'Au Pays Des Senteurs',
        articles: catalogue.articles.length,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

app.get('/status', (req, res) => {
    res.json({
        agent: 'KADI',
        store: 'Au Pays Des Senteurs',
        status: whatsapp.getState(),
        articles: catalogue.articles.length,
        categories: catalogue.categories
    });
});

app.get('/reconnect', async (req, res) => {
    try {
        await whatsapp.forceReconnect();
        res.json({ status: 'reconnecting' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.send(`
        <h1>Agent KADI</h1>
        <p>Boutique : Au Pays Des Senteurs</p>
        <p>Status: ${whatsapp.getState()}</p>
        <p>Articles: ${catalogue.articles.length}</p>
        <p><a href="/health">Health</a> | <a href="/status">Status</a> | <a href="/reconnect">Reconnect</a></p>
    `);
});

app.listen(config.PORT, () => {
    log(`Serveur sur http://localhost:${config.PORT}`);
});

whatsapp.start();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', (err) => log(`Exception: ${err.message}`, 'ERROR'));
process.on('unhandledRejection', (reason) => log(`Rejet: ${reason}`, 'ERROR'));