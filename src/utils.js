const fs = require('fs');
const path = require('path');

function readJSON(filePath, defaultValue = {}) {
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch { return defaultValue; }
}

function writeJSON(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch { return false; }
}

function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
}

function extractKeywords(text) {
    if (!text) return [];
    return normalizeText(text).split(/\s+/).filter(w => w.length > 2);
}

function formatArticle(article) {
    if (!article) return 'Article non trouvé';
    return `${article.nom}\nCatégorie : ${article.categorie}\nPrix : ${article.prix ? article.prix.toLocaleString() : 'N/A'} FCFA\nDescription : ${article.description}\nContact : ${process.env.CONTACT_PHONE || '0505730455'}\nDisponible : ${article.disponible ? 'Oui' : 'Non'}`;
}

function formatList(articles, title = 'Résultats', limit = 10) {
    if (!articles || !articles.length) return 'Aucun article trouvé';
    const list = articles.slice(0, limit);
    let msg = `${title} (${list.length} article${list.length > 1 ? 's' : ''})\n\n`;
    list.forEach((a, i) => {
        msg += `${i + 1}. ${a.nom}\n   Prix : ${a.prix ? a.prix.toLocaleString() : 'N/A'} FCFA\n   Catégorie : ${a.categorie}\n\n`;
    });
    if (articles.length > limit) msg += `... et ${articles.length - limit} autre(s)\n`;
    msg += `Pour plus d'infos : "info [nom]"`;
    return msg;
}

function getImagePath(name) { return path.join(__dirname, '../media/images', name); }
function getVideoPath(name) { return path.join(__dirname, '../media/videos', name); }
function fileExists(p) { return fs.existsSync(p); }
function getArticleImages(a) { return a?.images || []; }
function getArticleVideos(a) { return a?.videos || []; }

function log(message, type = 'INFO') {
    console.log(`[${new Date().toISOString()}] [${type}] ${message}`);
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
    readJSON, writeJSON, normalizeText, extractKeywords,
    formatArticle, formatList,
    getImagePath, getVideoPath, fileExists,
    getArticleImages, getArticleVideos,
    log, wait
};