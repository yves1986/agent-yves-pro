const fs = require('fs');
const path = require('path');

// Lire un fichier JSON en toute sécurité
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

// Écrire un fichier JSON
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

// Normaliser un texte
function normalizeText(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '');
}

// Extraire les mots-clés
function extractKeywords(text) {
    if (!text) return [];
    const words = normalizeText(text).split(/\s+/);
    return words.filter(w => w.length > 2);
}

// Formater un article
function formatArticle(article) {
    if (!article) return '❌ Article non trouvé';

    let msg = `🏠 *${article.nom}*\n`;
    msg += `📂 Catégorie : ${article.categorie}\n`;
    msg += `📍 Localisation : ${article.localisation}\n`;
    msg += `💰 Prix : ${article.prix ? article.prix.toLocaleString() : 'N/A'} FCFA\n`;
    if (article.prix_location) {
        msg += `🏠 Location : ${article.prix_location.toLocaleString()} FCFA/mois\n`;
    }
    msg += `📝 Description : ${article.description}\n`;
    msg += `📞 Contact : ${process.env.CONTACT_PHONE || '0140505518'}\n`;
    msg += `✅ Disponible : ${article.disponible ? 'Oui ✅' : 'Non ❌'}\n`;
    return msg;
}

// Log avec timestamp
function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

module.exports = {
    readJSON,
    writeJSON,
    normalizeText,
    extractKeywords,
    formatArticle,
    log
};