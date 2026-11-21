require('dotenv').config();
const path = require('path');
const express = require('express');
const Catalogue = require('./catalogue');
const IAService = require('./ia');
const WhatsAppService = require('./whatsapp');
const { log, readJSON } = require('./utils');

const config = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
    CONTACT_PHONE: process.env.CONTACT_PHONE || '0505730455',
    MY_PERSONAL_NUMBER: process.env.MY_PERSONAL_NUMBER || '0778602977', // converti en 2250778602977@c.us
    CATALOG_LINK: process.env.CATALOG_LINK || 'https://wa.me/c/22505730455',
    PORT: process.env.PORT || 3000
};

if (!config.ANTHROPIC_API_KEY) {
    log('ERREUR: ANTHROPIC_API_KEY manquante (clé API Claude, à créer sur console.anthropic.com)', 'FATAL');
    process.exit(1);
}

log(`AGENT KADI - DÉMARRAGE (IA : ${config.CLAUDE_MODEL})`);

const catalogue = new Catalogue();
const knowledge = readJSON(path.join(__dirname, '../data/knowledge_base.json'), { general_faq: [], products: {} });
const iaService = new IAService({
    apiKey: config.ANTHROPIC_API_KEY,
    model: config.CLAUDE_MODEL,
    catalogue,
    knowledge,
    contactPhone: config.CONTACT_PHONE,
    catalogLink: config.CATALOG_LINK
});
const whatsapp = new WhatsAppService(config, catalogue, iaService, knowledge);

const app = express();

app.get('/health', (req, res) => {
    res.json({
        status: whatsapp.getState(),
        connected: whatsapp.getState() === 'connected',
        store: 'Au Pays Des Senteurs',
        ai: config.CLAUDE_MODEL,
        articles: catalogue.articles.length,
        uptime: process.uptime(),
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

// La reconnexion prend plusieurs secondes : on répond tout de suite et on la lance en arrière-plan.
app.get('/reconnect', (req, res) => {
    whatsapp.forceReconnect().catch(err => log(`Reconnexion forcée échouée: ${err.message}`, 'ERROR'));
    res.json({ status: 'reconnecting' });
});

app.get('/', (req, res) => {
    res.send(`
        <h1>Agent KADI</h1>
        <p>Boutique : Au Pays Des Senteurs</p>
        <p>Status: ${whatsapp.getState()}</p>
        <p>IA : ${config.CLAUDE_MODEL}</p>
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
process.on('uncaughtException', (err) => log(`Exception: ${err.stack || err.message}`, 'ERROR'));
process.on('unhandledRejection', (reason) => log(`Rejet: ${reason}`, 'ERROR'));
