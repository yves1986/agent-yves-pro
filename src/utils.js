const fs = require('fs');
const path = require('path');

function readJSON(filePath, defaultValue = {}) {
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return defaultValue;
    }
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
    let msg = `${article.nom}\n`;
    msg += `Categorie : ${article.categorie}\n`;
    msg += `Prix : ${article.prix ? article.prix.toLocaleString() : 'N/A'} FCFA\n`;
    msg += `Description : ${article.description}\n`;
    msg += `Contact : ${process.env.CONTACT_PHONE || '0505730455'}\n`;
    msg += `Disponible : ${article.disponible ? 'Oui' : 'Non'}`;
    return msg;
}

function formatList(articles, title = 'Resultats', limit = 10) {
    if (!articles || articles.length === 0) return 'Aucun article trouve';
    const list = articles.slice(0, limit);
    let msg = `${title} (${list.length} article${list.length > 1 ? 's' : ''})\n\n`;
    list.forEach((a, i) => {
        msg += `${i + 1}. ${a.nom}\n`;
        msg += `   Prix : ${a.prix ? a.prix.toLocaleString() : 'N/A'} FCFA\n`;
        msg += `   Categorie : ${a.categorie}\n\n`;
    });
    if (articles.length > limit) msg += `... et ${articles.length - limit} autre(s)\n`;
    msg += `Pour plus d'infos, tapez "info [nom]"`;
    return msg;
}

function getImagePath(imageName) { return path.join(__dirname, '../media/images', imageName); }
function getVideoPath(videoName) { return path.join(__dirname, '../media/videos', videoName); }
function fileExists(filePath) { return fs.existsSync(filePath); }
function getArticleImages(article) { return article?.images || []; }
function getArticleVideos(article) { return article?.videos || []; }

function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

module.exports = {
    readJSON, writeJSON, normalizeText, extractKeywords,
    formatArticle, formatList,
    getImagePath, getVideoPath, fileExists,
    getArticleImages, getArticleVideos,
    log, wait
};