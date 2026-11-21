const path = require('path');
const { readJSON, normalizeText, extractKeywords, formatArticle, formatList, log } = require('./utils');

// Mots qui ne désignent pas un produit : ignorés pour la recherche.
const STOPWORDS = new Set([
    'commande', 'commander', 'commandes', 'veux', 'voudrais', 'aimerais', 'souhaite', 'prends', 'prendre',
    'acheter', 'achete', 'reserver', 'reservation', 'svp', 'stp', 'pour', 'avec', 'les', 'des', 'une', 'moi',
    'est', 'que', 'qui', 'quoi', 'combien', 'prix', 'info', 'infos', 'information', 'informations', 'photo',
    'photos', 'image', 'images', 'video', 'videos', 'bonjour', 'bonsoir', 'salut', 'merci', 'votre', 'vos',
    'mon', 'mes', 'sur', 'dans', 'cest', 'avoir', 'envoyer', 'envoyez', 'fcfa', 'coute', 'cout', 'oui', 'non',
    'quel', 'quelle', 'quels', 'plus', 'tous', 'tout', 'voir', 'peux', 'pouvez', 'aussi', 'encore', 'fois'
]);

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
        log(`${this.articles.length} articles chargés`);
    }

    // Un mot-clé correspond à un mot du nom s'il en est le début (ex. "minutes" ↔ "min", "sarak" ↔ "sarakatane").
    static wordMatches(keyword, words) {
        return words.some(w => w.length >= 3 && (w.startsWith(keyword) || keyword.startsWith(w)));
    }

    /**
     * Recherche par pertinence : retourne les articles ayant le meilleur score
     * (un seul article si la requête est précise, plusieurs si elle est ambiguë).
     */
    search(query) {
        if (!query || query.trim() === '') return this.articles.filter(a => a.disponible);
        const normalizedQuery = normalizeText(query).trim();

        const exactMatch = this.articles.find(a => a.disponible && normalizeText(a.nom) === normalizedQuery);
        if (exactMatch) return [exactMatch];

        const keywords = extractKeywords(query).filter(k => !STOPWORDS.has(k) && !/^\d+$/.test(k));
        if (!keywords.length) return [];

        const scored = this.articles
            .filter(a => a.disponible)
            .map(article => {
                const nameWords = normalizeText(article.nom).split(/\s+/);
                const otherText = normalizeText(`${article.categorie} ${article.mots_cles?.join(' ') || ''} ${article.description || ''}`);
                let score = 0;
                for (const kw of keywords) {
                    if (Catalogue.wordMatches(kw, nameWords)) score += 3;
                    else if (otherText.includes(kw)) score += 1;
                }
                return { article, score };
            })
            .filter(x => x.score > 0)
            .sort((x, y) => y.score - x.score);

        if (!scored.length) return [];
        const best = scored[0].score;
        return scored.filter(x => x.score === best).map(x => x.article);
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
    formatList(articles, title = 'Résultats') { return formatList(articles, title); }

    getMedia(article) {
        if (!article) return { images: [], videos: [] };
        return { images: article.images || [], videos: article.videos || [] };
    }
}

module.exports = Catalogue;
