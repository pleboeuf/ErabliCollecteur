# ErabliCollector

Application Node.js collectrice de données brutes.

Au démarrage, elle se connecte au Particle Cloud et écoute les événements pour les stocker. Un serveur web permet de télécharger les événements depuis un point précis dans le passé, et de recevoir les nouveaux événements dès qu'ils arrivent.

## 1. Install node modules

Assuming NPM is already installed:

    npm install

## 2. Create SQLite Database

    sqlite3 raw_events.sqlite3 < schema.sql

## 3. Configure

    cp config.json.sample config.json

Fill config.json with your access token from the Particle IDE.

## 3. Run!

    node app

Then point your browser to http://localhost:8150/

## To run the tests:

    sudo npm install -g expresso
    expresso
