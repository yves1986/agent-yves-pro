// Stockage de l'état de conversation (commande en attente, étape de livraison, historique...)
// - RedisStore : Upstash Redis (gratuit), indispensable sur Vercel où rien ne persiste entre deux requêtes.
// - MemoryStore : en mémoire + fichiers JSON locaux (mode WhatsApp Web sur un serveur classique, ou secours).
const fs = require('fs');
const path = require('path');
const { log } = require('./utils');

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 jours

class MemoryStore {
    constructor({ dir, persist = true } = {}) {
        this.persist = persist;
        this.sessionsPath = dir && path.join(dir, 'memory.json');
        this.ordersPath = dir && path.join(dir, 'orders.json');
        this.sessions = this.read(this.sessionsPath, {});
        this.orders = this.read(this.ordersPath, []);
        this.processed = new Map();
    }

    read(file, fallback) {
        if (!this.persist || !file || !fs.existsSync(file)) return fallback;
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
    }

    write(file, data) {
        if (!this.persist || !file) return;
        try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { log(`Écriture impossible ${file}: ${e.message}`, 'ERROR'); }
    }

    async getSession(user) { return structuredClone(this.sessions[user] || {}); }
    async saveSession(user, session) { this.sessions[user] = session; this.write(this.sessionsPath, this.sessions); }
    async addOrder(order) { this.orders.push(order); this.write(this.ordersPath, this.orders); }
    async listOrders(limit = 10) { return this.orders.slice(-limit).reverse(); }

    // true si le message n'a jamais été traité (WhatsApp peut renvoyer le même message plusieurs fois)
    async markProcessed(id) {
        const now = Date.now();
        for (const [k, t] of this.processed) if (now - t > 3600_000) this.processed.delete(k);
        if (this.processed.has(id)) return false;
        this.processed.set(id, now);
        return true;
    }
}

class RedisStore {
    constructor(redis) { this.redis = redis; }

    async getSession(user) { return (await this.redis.get(`kadi:session:${user}`)) || {}; }
    async saveSession(user, session) { await this.redis.set(`kadi:session:${user}`, session, { ex: SESSION_TTL }); }
    async addOrder(order) { await this.redis.lpush('kadi:orders', order); }
    async listOrders(limit = 10) { return this.redis.lrange('kadi:orders', 0, limit - 1); }
    async markProcessed(id) { return (await this.redis.set(`kadi:msg:${id}`, 1, { nx: true, ex: 86400 })) === 'OK'; }
}

// Upstash via Vercel Marketplace expose KV_REST_API_* ; une base Upstash créée à la main expose UPSTASH_REDIS_REST_*.
function createStore(options = {}) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (url && token) {
        const { Redis } = require('@upstash/redis');
        log('Stockage : Upstash Redis');
        return new RedisStore(new Redis({ url, token }));
    }
    if (options.requirePersistent) {
        log('Aucune base Redis configurée : état gardé en mémoire (perdu au redémarrage de la fonction)', 'WARNING');
    }
    return new MemoryStore(options);
}

module.exports = { createStore, MemoryStore, RedisStore };
