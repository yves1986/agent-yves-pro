require('dotenv').config();
const express = require('express');
const path = require('path');

const Catalogue = require('./catalogue');
const IAService = require('./ia');
const WhatsAppService = require('./whatsapp');
const { log } = require('./utils');

// ========== CONFIGURATION ==========
const config = {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_API_URL: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
    CONTACT_PHONE: process.env.CONTACT_PHONE || '0140505518',
    MY_PERSONAL_NUMBER: process.env.MY_PERSONAL_NUMBER || '2250710076550',
    PORT: process.env.PORT || 3000
};

// ========== VÉRIFICATION ==========
if (!config.DEEPSEEK_API_KEY) {
    log('❌ ERREUR: DEEPSEEK_API_KEY manquante dans .env', 'FATAL');
    process.exit(1);
}

log('🚀 AGENT KADI - DÉMARRAGE...', 'READY');
log(`🏪 Au Pays Des Senteurs`, 'INFO');
log(`📁 Dossier: ${__dirname}`, 'INFO');

// ========== INITIALISATION ==========
const catalogue = new Catalogue();
const iaService = new IAService(config.DEEPSEEK_API_KEY, config.DEEPSEEK_API_URL);
const whatsapp = new WhatsAppService(config, catalogue, iaService);

// ========== SERVEUR HTTP ==========
const app = express();

app.get('/health', (req, res) => {
    const state = whatsapp.getState();
    res.json({
        status: state,
        connected: state === 'connected',
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
        categories: catalogue.categories,
        catalogLink: process.env.CATALOG_LINK || 'https://wa.me/c/122990784208917',
        uptime: process.uptime()
    });
});

app.get('/reconnect', async (req, res) => {
    try {
        await whatsapp.forceReconnect();
        res.json({ status: 'reconnecting', message: 'Reconnexion en cours...' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.send(`
        <h1>🤖 Agent KADI</h1>
        <h2>🏪 Au Pays Des Senteurs</h2>
        <p>Status: <strong>${whatsapp.getState()}</strong></p>
        <p>Articles: ${catalogue.articles.length}</p>
        <p>Catégories: ${catalogue.categories.join(', ')}</p>
        <p>Uptime: ${Math.round(process.uptime() / 60)} minutes</p>
        <p><a href="/health">Health Check</a> | <a href="/status">Status</a> | <a href="/reconnect">Reconnect</a></p>
        <p>🔗 Catalogue: <a href="${process.env.CATALOG_LINK || 'https://wa.me/c/122990784208917'}">${process.env.CATALOG_LINK || 'https://wa.me/c/122990784208917'}</a></p>
    `);
});

app.listen(config.PORT, () => {
    log(`🌐 Serveur sur http://localhost:${config.PORT}`, 'INFO');
    log(`📊 Health: http://localhost:${config.PORT}/health`, 'INFO');
});

// ========== DÉMARRAGE ==========
whatsapp.start();

// ========== GESTION ARRÊT ==========
process.on('SIGINT', () => {
    log('🛑 Arrêt demandé', 'INFO');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('🛑 Arrêt demandé', 'INFO');
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    log(`Exception non capturée: ${err.message}`, 'ERROR');
});

process.on('unhandledRejection', (reason) => {
    log(`Rejet non géré: ${reason}`, 'ERROR');
});