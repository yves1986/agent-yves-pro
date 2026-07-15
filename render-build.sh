#!/usr/bin/env bash
# exit on error
set -o errexit

# Installation des dépendances
npm install

# Définir le cache Puppeteer
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR

# Installer Chrome via Puppeteer
npx puppeteer browsers install chrome

# Copier le cache si nécessaire
if [[ ! -d $PUPPETEER_CACHE_DIR ]]; then
    echo "...Copie du cache Puppeteer"
    cp -R /opt/render/project/src/.cache/puppeteer/chrome/ $PUPPETEER_CACHE_DIR
else
    echo "...Stockage du cache Puppeteer"
    cp -R $PUPPETEER_CACHE_DIR /opt/render/project/src/.cache/puppeteer/chrome/
fi