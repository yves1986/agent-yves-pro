// Assemble KADI (config, catalogue, Claude, stockage) pour n'importe quel mode d'exécution.
const Catalogue = require('./catalogue');
const IAService = require('./ia');
const KadiBot = require('./bot');
const { createStore } = require('./store');
const { fileExists, getImagePath, getVideoPath } = require('./utils');

function loadConfig() {
    return {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
        CONTACT_PHONE: process.env.CONTACT_PHONE || '0505730455',
        MY_PERSONAL_NUMBER: process.env.MY_PERSONAL_NUMBER || '0778602977', // converti en 2250778602977
        CATALOG_LINK: process.env.CATALOG_LINK || 'https://wa.me/c/22505730455',
        PORT: process.env.PORT || 3000
    };
}

// Sur Vercel, les fichiers de public/ ne sont pas dans la fonction : on lit la liste générée au build.
// Ailleurs, on vérifie directement le disque.
function createMediaCheck() {
    let manifest = null;
    try { manifest = require('./media-manifest.json'); } catch (e) { }
    return (kind, file) => {
        if (fileExists(kind === 'video' ? getVideoPath(file) : getImagePath(file))) return true;
        return !!manifest && (kind === 'video' ? manifest.videos : manifest.images).includes(file);
    };
}

function createKadi(storeOptions = {}) {
    const config = loadConfig();
    const catalogue = new Catalogue();
    const knowledge = require('../data/knowledge_base.json');
    const ia = new IAService({
        apiKey: config.ANTHROPIC_API_KEY,
        model: config.CLAUDE_MODEL,
        catalogue,
        knowledge,
        contactPhone: config.CONTACT_PHONE,
        catalogLink: config.CATALOG_LINK
    });
    const store = createStore(storeOptions);
    const bot = new KadiBot({ config, catalogue, ia, knowledge, store, hasMedia: createMediaCheck() });
    return { config, catalogue, knowledge, ia, store, bot };
}

module.exports = { loadConfig, createKadi, createMediaCheck };
