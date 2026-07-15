const fs = require('fs');
const path = require('path');

// ========== FICHIERS ==========
function readJSON(filePath, defaultValue = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            return defaultValue;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`❌ Erreur lecture ${filePath}:`, err.message);
        return defaultValue;
    }
}

function writeJSON(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        console.error(`❌ Erreur écriture ${filePath}:`, err.message);
        return false;
    }
}

// ========== TEXTE ==========
function normalizeText(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '');
}

function extractKeywords(text) {
    if (!text) return [];
    const words = normalizeText(text).split(/\s+/);
    return words.filter(w => w.length > 2);
}

// ========== FORMATAGE ==========
function formatArticle(article, catalogLink) {
    if (!article) return '❌ Article non trouvé';

    let msg = `🛍️ *${article.nom}*\n`;
    msg += `📂 Catégorie : ${article.categorie}\n`;
    msg += `💰 Prix : ${article.prix ? article.prix.toLocaleString() : 'N/A'} FCFA\n`;
    msg += `📝 Description : ${article.description}\n`;
    msg += `📞 Contactez KADI : ${process.env.CONTACT_PHONE || '0140505518'}\n`;
    msg += `✅ Disponible : ${article.disponible ? 'Oui ✅' : 'Non ❌'}\n`;

    if (article.images && article.images.length > 0) {
        msg += `\n📸 *${article.images.length} photo(s) disponible(s)*\n`;
        msg += `🔍 Tapez "images ${article.nom}" pour les voir\n`;
    }
    if (article.videos && article.videos.length > 0) {
        msg += `🎬 *${article.videos.length} vidéo(s) disponible(s)*\n`;
        msg += `🔍 Tapez "video ${article.nom}" pour la voir\n`;
    }

    msg += `\n🔗 *Catalogue complet :* ${catalogLink}`;

    return msg;
}

function formatList(articles, title = '📋 Résultats', limit = 10) {
    if (!articles || articles.length === 0) {
        return '📭 Aucun article trouvé';
    }

    const list = articles.slice(0, limit);
    let msg = `${title} (${list.length} article${list.length > 1 ? 's' : ''})\n\n`;

    list.forEach((a, i) => {
        msg += `${i + 1}. *${a.nom}*\n`;
        msg += `   💰 ${a.prix ? a.prix.toLocaleString() : 'N/A'} FCFA\n`;
        msg += `   📂 ${a.categorie}\n\n`;
    });

    if (articles.length > limit) {
        msg += `_... et ${articles.length - limit} autre(s)_\n`;
    }
    msg += `\n🔍 Pour plus d'infos, tapez "info [nom]"`;
    msg += `\n🔗 *Catalogue complet :* ${process.env.CATALOG_LINK || 'https://wa.me/c/122990784208917'}`;

    return msg;
}

// ========== MÉDIAS ==========
function getImagePath(imageName) {
    return path.join(__dirname, '../media/images', imageName);
}

function getVideoPath(videoName) {
    return path.join(__dirname, '../media/videos', videoName);
}

function fileExists(filePath) {
    return fs.existsSync(filePath);
}

function getArticleImages(article) {
    if (!article || !article.images) return [];
    return article.images;
}

function getArticleVideos(article) {
    if (!article || !article.videos) return [];
    return article.videos;
}

// ========== LOG ==========
function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const emojis = {
        INFO: '📝',
        SUCCESS: '✅',
        ERROR: '❌',
        WARNING: '⚠️',
        FATAL: '💀',
        RECONNECT: '🔄',
        READY: '🚀'
    };
    console.log(`[${timestamp}] [${type}] ${emojis[type] || '📝'} ${message}`);
}

// ========== DELAI NATUREL ==========
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    readJSON,
    writeJSON,
    normalizeText,
    extractKeywords,
    formatArticle,
    formatList,
    getImagePath,
    getVideoPath,
    fileExists,
    getArticleImages,
    getArticleVideos,
    log,
    wait
};