// Liste des dernières commandes (protégée) : https://<projet>.vercel.app/api/orders?token=ADMIN_TOKEN
import setup from '../src/setup.js';

let kadi;

export async function GET(request) {
    const url = new URL(request.url);
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || url.searchParams.get('token') !== expected) {
        return new Response('Accès refusé', { status: 401 });
    }
    if (!kadi) kadi = setup.createKadi({ persist: false });
    const orders = await kadi.store.listOrders(Number(url.searchParams.get('limit')) || 50);

    if (url.searchParams.get('format') === 'json') return Response.json(orders);

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const rows = orders.map(o => `<tr><td>${esc(new Date(o.date).toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' }))}</td><td>${esc(o.clientName)}</td><td>${esc(o.numero)}</td><td>${esc(o.commune)}</td><td>${esc(o.produit)}</td><td>${esc(o.quantite)}</td><td>${esc(Number(o.total || 0).toLocaleString('fr-FR'))} FCFA</td><td><a href="https://wa.me/${esc(o.client)}">WhatsApp</a></td></tr>`).join('');
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Commandes KADI</title>
<style>body{font-family:system-ui,sans-serif;margin:16px;color:#222}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{background:#f4efe6}.wrap{overflow-x:auto}</style></head>
<body><h1>Commandes KADI</h1><p>${orders.length} dernière(s) commande(s)</p><div class="wrap"><table><thead><tr><th>Date</th><th>Client</th><th>Téléphone</th><th>Commune</th><th>Produit</th><th>Qté</th><th>Total</th><th>Contact</th></tr></thead><tbody>${rows || '<tr><td colspan="8">Aucune commande</td></tr>'}</tbody></table></div></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
