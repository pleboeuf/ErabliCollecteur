# ErabliCollector

Application Node.js collectrice de données brutes.

## 1. Install node modules

Assuming NPM is already installed:

    npm install

## 2. Create SQLite Database

    sqlite3 raw_events.sqlite3 < schema.sql

(for some reason the header is not printed until there is a row, so run first, then re-run this last line)

## 3. Configure

    cp run.sh.sample run.sh

Fill run.sh with your device IDs.

Get your access token and device IDs from the spark IDE.

## 3. Run!

    ./run.sh

## To run the tests:

    sudo npm install -g expresso
    expresso
