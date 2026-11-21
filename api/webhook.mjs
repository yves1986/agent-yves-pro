// Webhook de l'API WhatsApp Cloud (Meta) pour Vercel.
// GET  : vérification du webhook par Meta (hub.challenge)
// POST : messages entrants → réponse 200 immédiate, traitement en arrière-plan (waitUntil)
import { waitUntil } from '@vercel/functions';
import setup from '../src/setup.js';
import cloud from '../src/cloud.js';
import utils from '../src/utils.js';

const { createKadi } = setup;
const { verifySignature, parseWebhook, CloudSender } = cloud;
const { log } = utils;

let kadi; // réutilisé entre requêtes tant que l'instance reste chaude
function getKadi() {
    if (!kadi) kadi = createKadi({ persist: false, requirePersistent: true });
    return kadi;
}

function getSender() {
    const host = process.env.PUBLIC_BASE_URL || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL}`;
    return new CloudSender({
        token: process.env.WHATSAPP_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        publicBaseUrl: host
    });
}

export function GET(request) {
    const url = new URL(request.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe') {
        if (token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
            log('Webhook vérifié par Meta');
            return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
        }
        return new Response('Jeton de vérification invalide', { status: 403 });
    }
    return Response.json({ agent: 'KADI', mode: 'whatsapp-cloud', ok: true });
}

async function processMessages(messages) {
    const { bot, store } = getKadi();
    const sender = getSender();
    for (const m of messages) {
        if (!(await store.markProcessed(m.id))) continue; // Meta renvoie parfois le même message
        log(`Message de ${m.name || m.user} [${m.type}]: ${(m.text || '').substring(0, 50)}`);
        await sender.markRead(m.id);
        const result = await bot.handle({ user: m.user, name: m.name, type: m.type, text: m.text });
        await sender.deliver(m.user, result);
    }
}

export async function POST(request) {
    const raw = await request.text();
    if (!verifySignature(raw, request.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET)) {
        log('Signature Meta invalide : requête rejetée', 'WARNING');
        return new Response('Signature invalide', { status: 403 });
    }

    let payload;
    try { payload = JSON.parse(raw); } catch { return new Response('JSON invalide', { status: 400 }); }

    const messages = parseWebhook(payload);
    if (messages.length) {
        waitUntil(processMessages(messages).catch(err => log(`Erreur traitement webhook: ${err.stack || err.message}`, 'ERROR')));
    }
    return new Response('EVENT_RECEIVED', { status: 200 });
}
