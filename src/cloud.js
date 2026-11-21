// Transport "API WhatsApp Cloud" (officielle, Meta) : reçoit les webhooks et envoie les réponses.
// Utilisé par api/webhook.mjs sur Vercel.
const crypto = require('crypto');
const { log } = require('./utils');

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v24.0';

// Vérifie l'en-tête X-Hub-Signature-256 (HMAC SHA-256 du corps brut avec le secret de l'app Meta).
function verifySignature(rawBody, signatureHeader, appSecret) {
    if (!appSecret) return true; // non configuré : on accepte (déconseillé en production)
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extrait les messages entrants d'un webhook Meta (les accusés de lecture/livraison sont ignorés).
function parseWebhook(payload) {
    const messages = [];
    for (const entry of payload?.entry || []) {
        for (const change of entry.changes || []) {
            const value = change.value || {};
            const names = Object.fromEntries((value.contacts || []).map(c => [c.wa_id, c.profile?.name]));
            for (const m of value.messages || []) {
                const text = m.text?.body
                    || m.image?.caption || m.video?.caption || m.document?.caption
                    || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title
                    || '';
                const type = m.type === 'button' || m.type === 'interactive' ? 'text' : m.type;
                messages.push({ id: m.id, user: m.from, name: names[m.from], type, text });
            }
        }
    }
    return messages;
}

class CloudSender {
    constructor({ token, phoneNumberId, publicBaseUrl }) {
        this.token = token;
        this.phoneNumberId = phoneNumberId;
        this.publicBaseUrl = (publicBaseUrl || '').replace(/\/$/, '');
    }

    async post(body) {
        const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${this.phoneNumberId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body })
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Graph API ${res.status}: ${err.substring(0, 300)}`);
        }
        return res.json();
    }

    // WhatsApp limite un texte à 4096 caractères
    async sendText(to, text) {
        for (let i = 0; i < text.length; i += 4000) {
            await this.post({ to, type: 'text', text: { body: text.slice(i, i + 4000), preview_url: true } });
        }
    }

    // Les médias sont servis par Vercel depuis public/media/... (Meta les télécharge via le lien)
    async sendMedia(to, kind, file, caption) {
        const folder = kind === 'video' ? 'videos' : 'images';
        const link = `${this.publicBaseUrl}/media/${folder}/${encodeURIComponent(file)}`;
        await this.post({ to, type: kind, [kind]: { link, caption } });
    }

    async markRead(messageId) {
        try { await this.post({ status: 'read', message_id: messageId }); } catch (e) { /* sans importance */ }
    }

    async deliver(to, { replies, notifications }) {
        for (const r of replies) {
            try {
                if (r.kind === 'text') await this.sendText(to, r.text);
                else await this.sendMedia(to, r.kind, r.file, r.caption);
            } catch (err) {
                log(`Échec envoi ${r.kind} à ${to}: ${err.message}`, 'ERROR');
            }
        }
        for (const n of notifications) {
            try {
                await this.sendText(n.to, n.text);
            } catch (err) {
                // Erreur 131047 : l'admin n'a pas écrit au bot depuis 24 h (règle Meta). La commande reste visible sur /api/orders.
                log(`Notification admin non envoyée (${err.message}). Voir /api/orders`, 'WARNING');
            }
        }
    }
}

module.exports = { verifySignature, parseWebhook, CloudSender };
