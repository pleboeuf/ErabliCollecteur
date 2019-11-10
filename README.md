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

Fill config.json with your access credentials from the Particle IDE.

## 3. Run!

    node app

    in playback mode, two optional parameters
        noStream:           Prevent connection to event stream
        allDeviceReplay:    Replay all events from the raw database upon start

    node app noStream allDeviceReplay 

Then point your browser to http://localhost:8150/

## To run the tests:

    sudo npm install -g expresso
    expresso

## To build a Docker image

Building an image off an official Node base image allows to run containers
on a system having any Node version installed - or none at all - as long
as Docker can run.

    docker build -t elecnix/erablicollecteur .

That creates an image containing your config.json.

To run it:

    docker run -d --volume=$(pwd)/data:/data -p 8150:8150 elecnix/erablicollecteur

Again, point your browser to http://localhost:8150/
