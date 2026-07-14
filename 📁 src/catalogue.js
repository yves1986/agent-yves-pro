const path = require('path');
const { readJSON, normalizeText, extractKeywords, formatArticle, log } = require('./utils');

class Catalogue {
    constructor() {
        this.dataPath = path.join(__dirname, '../data/catalogue.json');
        this.articles = [];
        this.categories = [];
        this.load();
    }

    load() {
        const data = readJSON(this.dataPath);
        this.articles = data.articles || [];
        this.categories = data.categories || [];
        log(`${this.articles.length} articles chargés`, 'CATALOGUE');
    }

    search(query) {
        if (!query || query.trim() === '') {
            return this.articles.filter(a => a.disponible);
        }

        const keywords = extractKeywords(query);
        if (keywords.length === 0) return [];

        const results = this.articles.filter(article => {
            if (!article.disponible) return false;

            const searchText = normalizeText(
                `${article.nom} ${article.description} ${article.categorie} ${article.localisation} ${article.mots_cles?.join(' ') || ''}`
            );

            return keywords.some(keyword => searchText.includes(keyword));
        });

        return results;
    }

    getById(id) {
        return this.articles.find(a => a.id === id);
    }

    getByCategory(category) {
        if (!category) return [];
        const normalizedCat = normalizeText(category);
        return this.articles.filter(a =>
            a.disponible &&
            normalizeText(a.categorie).includes(normalizedCat)
        );
    }

    formatList(articles, limit = 10) {
        if (!articles || articles.length === 0) {
            return "📭 Aucun article trouvé";
        }

        const list = articles.slice(0, limit);
        let msg = `📋 *${list.length} article(s) trouvé(s)*\n\n`;

        list.forEach((a, i) => {
            msg += `${i + 1}. *${a.nom}*\n`;
            msg += `   💰 ${a.prix ? a.prix.toLocaleString() : 'N/A'} FCFA\n`;
            msg += `   📍 ${a.localisation}\n\n`;
        });

        if (articles.length > limit) {
            msg += `_... et ${articles.length - limit} autre(s)_\n`;
        }
        msg += `\n🔍 Pour plus d'infos, tapez "info [nom]"`;

        return msg;
    }

    formatFull(article) {
        if (!article) return "❌ Article non trouvé";
        return formatArticle(article);
    }

    // Recharger le catalogue (utile pour les mises à jour)
    reload() {
        this.load();
        return this.articles.length;
    }
}

module.exports = Catalogue;