# Agent KADI - Au Pays Des Senteurs

Conseillère WhatsApp de la boutique Au Pays Des Senteurs : catalogue, photos/vidéos, FAQ, prise de commande
et réponses libres par l'IA **Claude** (Anthropic).

## Deux façons de faire tourner KADI

| Mode | Fichier d'entrée | Où | Connexion WhatsApp |
|---|---|---|---|
| **WhatsApp Cloud (recommandé)** | `api/webhook.mjs` | Vercel (projet `agent-kadi`) | API officielle Meta, par webhook |
| WhatsApp Web | `src/index.js` (`npm start`) | Render, VPS ou PC allumé en permanence | QR code + Chrome (`whatsapp-web.js`) |

Les deux modes partagent la même logique (`src/bot.js`) : seule la connexion change.

## Mise en place gratuite sur Vercel (mode WhatsApp Cloud)

Ce qui est gratuit : Vercel (plan Hobby), Upstash Redis (offre gratuite), l'API WhatsApp Cloud pour
répondre aux clients qui vous écrivent (fenêtre de 24 h). **Seul Claude est payant** (à l'usage, quelques
dollars de crédit suffisent pour démarrer) ; KADI répond sans Claude à tout ce qui est prévu
(catalogue, prix, commandes, FAQ) et n'appelle Claude que pour les questions libres.

### 1. Clé Claude
1. Créez un compte sur https://console.anthropic.com et ajoutez un peu de crédit (Billing).
2. Créez une clé dans *Settings > API Keys*.
3. Dans Vercel > projet `agent-kadi` > *Settings > Environment Variables*, ajoutez `ANTHROPIC_API_KEY`.
4. Facultatif : `CLAUDE_MODEL=claude-haiku-5-5` pour un coût environ 40 fois plus faible que le modèle par défaut (`claude-opus-5-5`).

### 2. Base Redis gratuite (mémoire des conversations et commandes)
Vercel > projet `agent-kadi` > onglet *Storage* > *Create Database* > **Upstash for Redis** > offre *Free* >
connecter au projet. Les variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` sont ajoutées automatiquement.
Redéployez ensuite (*Deployments > ... > Redeploy*).

### 3. Application WhatsApp (Meta)
1. Sur https://developers.facebook.com : *Mes apps > Créer une app* > type **Business** > ajoutez le produit **WhatsApp**.
2. *WhatsApp > Configuration de l'API* : notez l'**ID du numéro de téléphone** → variable `WHATSAPP_PHONE_NUMBER_ID`.
   Pour tester tout de suite, Meta fournit un numéro de test gratuit (jusqu'à 5 destinataires vérifiés).
   Pour les vrais clients, ajoutez votre numéro de boutique (il ne pourra plus être utilisé dans l'appli WhatsApp normale).
3. Jeton d'accès : le jeton temporaire expire en 24 h. Pour un jeton permanent :
   *business.facebook.com > Paramètres > Utilisateurs système* > créer un utilisateur système admin >
   lui attribuer l'app > *Générer un jeton* avec les permissions `whatsapp_business_messaging` et
   `whatsapp_business_management` → variable `WHATSAPP_TOKEN`.
4. *Paramètres de l'app > Général* : **Clé secrète** → variable `WHATSAPP_APP_SECRET`.
5. *WhatsApp > Configuration > Webhook* :
   - URL de rappel : `https://agent-kadi.vercel.app/api/webhook`
   - Jeton de vérification : la valeur de `WHATSAPP_VERIFY_TOKEN` (déjà créée dans Vercel)
   - Cliquez *Vérifier et enregistrer*, puis abonnez-vous au champ **messages**.

### 4. Commandes reçues
- Chaque commande est envoyée par WhatsApp au numéro `MY_PERSONAL_NUMBER`. Règle Meta : ce numéro doit avoir
  écrit au bot dans les dernières 24 h (envoyez par exemple `!commandes` chaque matin).
- Toutes les commandes sont aussi visibles sur `https://agent-kadi.vercel.app/api/orders?token=ADMIN_TOKEN`
  (valeur de `ADMIN_TOKEN` dans les variables Vercel).

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | Clé API Claude (obligatoire) |
| `CLAUDE_MODEL` | Modèle Claude (défaut `claude-opus-5-5`) |
| `WHATSAPP_TOKEN` | Jeton d'accès Meta (mode Cloud) |
| `WHATSAPP_PHONE_NUMBER_ID` | ID du numéro WhatsApp (mode Cloud) |
| `WHATSAPP_APP_SECRET` | Secret de l'app Meta (obligatoire : sans lui le webhook refuse tout) |
| `WHATSAPP_VERIFY_TOKEN` | Jeton choisi pour la vérification du webhook |
| `ADMIN_TOKEN` | Mot de passe de la page `/api/orders` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (ajoutées par l'intégration Vercel) |
| `CONTACT_PHONE` | Numéro affiché aux clients |
| `MY_PERSONAL_NUMBER` | Numéro qui reçoit les commandes (format local `07...` accepté) |
| `CATALOG_LINK` | Lien du catalogue WhatsApp |

## Commandes WhatsApp

- `!catalogue`, `!categories`, `!aide`, `contact`
- `info [nom]`, `prix [nom]`, `images [nom]`, `video [nom]`
- `je commande [quantité] [nom]` puis confirmation, nom, commune, téléphone
- `!commandes` (numéro admin uniquement) : 10 dernières commandes

## Ajouter des photos / vidéos

Déposez les fichiers dans `public/media/images` ou `public/media/videos` avec le nom indiqué dans
`data/catalogue.json`. KADI ne propose que les médias réellement présents.
