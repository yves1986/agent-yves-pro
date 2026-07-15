const path = require('path');
const { readJSON, normalizeText, extractKeywords, formatArticle, formatList, log } = require('./utils');

class Catalogue {
    constructor() {
        this.dataPath = path.join(__dirname, '../data/catalogue.json');
        this.articles = [];
        this.categories = [];
        this.catalogLink = process.env.CATALOG_LINK || 'https://wa.me/c/122990784208917';
        this.load();
    }

    load() {
        const data = readJSON(this.dataPath);
        this.articles = data.articles || [];
        this.categories = data.categories || [];
        log(`${this.articles.length} articles chargés`, 'SUCCESS');
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
                `${article.nom} ${article.description} ${article.categorie} ${article.localisation || ''} ${article.mots_cles?.join(' ') || ''}`
            );

            return keywords.some(keyword => searchText.includes(keyword));
        });

        return results;
    }

    searchByCategory(category) {
        if (!category) return [];
        const normalizedCat = normalizeText(category);
        return this.articles.filter(a =>
            a.disponible &&
            normalizeText(a.categorie).includes(normalizedCat)
        );
    }

    getById(id) {
        return this.articles.find(a => a.id === id);
    }

    getCategoriesWithCount() {
        const counts = {};
        this.categories.forEach(cat => {
            const count = this.articles.filter(a =>
                a.categorie === cat && a.disponible
            ).length;
            counts[cat] = count;
        });
        return counts;
    }

    formatArticle(article) {
        return formatArticle(article, this.catalogLink);
    }

    formatList(articles, title = '📋 Résultats') {
        return formatList(articles, title);
    }

    getMedia(article) {
        if (!article) return { images: [], videos: [] };
        return {
            images: article.images || [],
            videos: article.videos || []
        };
    }

    reload() {
        this.load();
        return this.articles.length;
    }
}

module.exports = Catalogue;