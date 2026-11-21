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

// Chemins des médias
function getImagePath(name) { return path.join(__dirname, '../public/media/images', name); }
function getVideoPath(name) { return path.join(__dirname, '../public/media/videos', name); }
function fileExists(p) { return fs.existsSync(p); }
function getArticleImages(a) { return a?.images || []; }
function getArticleVideos(a) { return a?.videos || []; }

// Log avec horodatage
function log(message, type = 'INFO') {
    console.log(`[${new Date().toISOString()}] [${type}] ${message}`);
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Convertit un numéro (ex. "07 78 60 29 77" ou "2250778602977") en identifiant WhatsApp "2250778602977@c.us".
// Les numéros ivoiriens locaux à 10 chiffres commençant par 0 reçoivent l'indicatif 225.
function toWhatsAppId(number) {
    let digits = String(number || '').replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) digits = `225${digits}`;
    return digits ? `${digits}@c.us` : null;
}

// Fonction utilitaire pour lister les fichiers d'un dossier (debug)
function listFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
}

module.exports = {
    readJSON, writeJSON, normalizeText, extractKeywords,
    formatArticle, formatList,
    getImagePath, getVideoPath, fileExists,
    getArticleImages, getArticleVideos,
    log, wait, listFiles, toWhatsAppId
};