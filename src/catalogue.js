const path = require('path');
const { readJSON, normalizeText, extractKeywords, formatArticle, formatList, log } = require('./utils');

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
        log(`${this.articles.length} articles charges`);
    }

    search(query) {
        if (!query || query.trim() === '') return this.articles.filter(a => a.disponible);
        const keywords = extractKeywords(query);
        if (!keywords.length) return [];
        return this.articles.filter(article => {
            if (!article.disponible) return false;
            const searchText = normalizeText(
                `${article.nom} ${article.description} ${article.categorie} ${article.localisation || ''} ${article.mots_cles?.join(' ') || ''}`
            );
            return keywords.some(k => searchText.includes(k));
        });
    }

    searchByCategory(category) {
        if (!category) return [];
        const cat = normalizeText(category);
        return this.articles.filter(a => a.disponible && normalizeText(a.categorie).includes(cat));
    }

    getById(id) { return this.articles.find(a => a.id === id); }

    getCategoriesWithCount() {
        const counts = {};
        this.categories.forEach(cat => {
            counts[cat] = this.articles.filter(a => a.categorie === cat && a.disponible).length;
        });
        return counts;
    }

    formatArticle(article) { return formatArticle(article); }
    formatList(articles, title = 'Resultats') { return formatList(articles, title); }

    getMedia(article) {
        if (!article) return { images: [], videos: [] };
        return { images: article.images || [], videos: article.videos || [] };
    }
}

module.exports = Catalogue;