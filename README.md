# ErabliPi

Application Node.js affichant le niveau de réservoirs d'une érablière.

## 1. Install node modules, assuming NPM is already installed:

    npm install

## 2. Create SQLite Database

    sqlite3 erablipi.sqlite3 < schema.sql
    sqlite3 erablipi.sqlite3 -header -separator $'\t' 'select reading_date, raw_reading, gallons from tank_reading' > public/tank-levels.csv

## 3. Run!

    ACCESS_TOKEN=abcdef1234 node app

