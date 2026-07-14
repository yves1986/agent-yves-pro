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

log('🚀 AGENT YVES PRO - DÉMARRAGE...', 'INIT');
log(`📁 Dossier: ${__dirname}`, 'INIT');

// ========== INITIALISATION ==========
const catalogue = new Catalogue();
const iaService = new IAService(config.DEEPSEEK_API_KEY, config.DEEPSEEK_API_URL);
const whatsapp = new WhatsAppService(config, catalogue, iaService);

// ========== SERVEUR HTTP ==========
const app = express();

// Health check
app.get('/health', (req, res) => {
    const state = whatsapp.getState();
    res.json({
        status: state,
        connected: state === 'connected',
        articles: catalogue.articles.length,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

// Status
app.get('/status', (req, res) => {
    res.json({
        agent: 'AGENT_YVES_PRO',
        status: whatsapp.getState(),
        articles: catalogue.articles.length,
        uptime: process.uptime()
    });
});

// Force reconnect
app.get('/reconnect', async (req, res) => {
    try {
        await whatsapp.forceReconnect();
        res.json({ status: 'reconnecting', message: 'Reconnexion en cours...' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Home
app.get('/', (req, res) => {
    res.send(`
        <h1>🤖 Agent Yves Pro</h1>
        <p>Status: <strong>${whatsapp.getState()}</strong></p>
        <p>Articles: ${catalogue.articles.length}</p>
        <p>Uptime: ${Math.round(process.uptime() / 60)} minutes</p>
        <p><a href="/health">Health Check</a> | <a href="/status">Status</a></p>
    `);
});

// Démarrer le serveur
app.listen(config.PORT, () => {
    log(`🌐 Serveur sur http://localhost:${config.PORT}`, 'SERVER');
    log(`📊 Health: http://localhost:${config.PORT}/health`, 'SERVER');
    log(`🔁 Reconnect: http://localhost:${config.PORT}/reconnect`, 'SERVER');
});

// ========== DÉMARRAGE WHATSAPP ==========
whatsapp.start();

// ========== GESTION ARRÊT ==========
process.on('SIGINT', () => {
    log('🛑 Arrêt demandé (SIGINT)', 'SHUTDOWN');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('🛑 Arrêt demandé (SIGTERM)', 'SHUTDOWN');
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    log(`❌ Exception non capturée: ${err.message}`, 'FATAL');
    // Ne pas quitter
});

process.on('unhandledRejection', (reason) => {
    log(`❌ Rejet non géré: ${reason}`, 'FATAL');
    // Ne pas quitter
});