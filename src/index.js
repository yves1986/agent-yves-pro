// Mode WhatsApp Web (serveur allumé en permanence : Render, VPS, PC). Lancer avec : npm start
require('dotenv').config();
const path = require('path');
const express = require('express');
const { createKadi } = require('./setup');
const WhatsAppService = require('./whatsapp');
const { log } = require('./utils');

const { config, catalogue, bot } = createKadi({ dir: path.join(__dirname, '../data') });

if (!config.ANTHROPIC_API_KEY) {
    log('ERREUR: ANTHROPIC_API_KEY manquante (clé API Claude, à créer sur console.anthropic.com)', 'FATAL');
    process.exit(1);
}

log(`AGENT KADI - DÉMARRAGE (WhatsApp Web, IA : ${config.CLAUDE_MODEL})`);
const whatsapp = new WhatsAppService(config, bot);

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

// La reconnexion prend plusieurs secondes : on répond tout de suite et on la lance en arrière-plan.
app.get('/reconnect', (req, res) => {
    whatsapp.forceReconnect().catch(err => log(`Reconnexion forcée échouée: ${err.message}`, 'ERROR'));
    res.json({ status: 'reconnecting' });
});

app.get('/', (req, res) => {
    res.send(`<h1>Agent KADI</h1><p>Boutique : Au Pays Des Senteurs</p><p>Status: ${whatsapp.getState()}</p><p>IA : ${config.CLAUDE_MODEL}</p><p><a href="/health">Health</a> | <a href="/reconnect">Reconnect</a></p>`);
});

app.listen(config.PORT, () => log(`Serveur sur http://localhost:${config.PORT}`));
whatsapp.start();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', (err) => log(`Exception: ${err.stack || err.message}`, 'ERROR'));
process.on('unhandledRejection', (reason) => log(`Rejet: ${reason}`, 'ERROR'));
