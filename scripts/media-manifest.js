// Génère src/media-manifest.json : la liste des photos/vidéos réellement présentes dans public/media.
// Lancé automatiquement par "npm run build" (Vercel) ; sur un serveur classique KADI vérifie les fichiers directement.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const manifest = {
    images: list(path.join(root, 'public/media/images')),
    videos: list(path.join(root, 'public/media/videos'))
};
fs.writeFileSync(path.join(root, 'src/media-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`media-manifest : ${manifest.images.length} photos, ${manifest.videos.length} vidéos`);
