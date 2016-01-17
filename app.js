//
// Store Spark Core devices raw events
//
var Promise = require('promise');
var http = require('https');
var spark = require('spark');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('erablipi.sqlite3');
var express = require('express');
var path = require('path');
const eventmodule = require('./event.js');
var accessToken = process.env.ACCESS_TOKEN;

var app = express();
app.use(app.router);
app.use(express.logger());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', express.static(path.join(__dirname, 'index.html')));
app.get('/tank/:name/levels.tsv', function(req, res) {
  // console.log('Get ' + req.params.name);
  db.serialize(function() {
    db.all("select reading_date, gallons from tank_reading where device_name = ? and datetime(reading_date / 1000, 'unixepoch') >= date('now','-1 day') order by reading_date desc", [req.params.name], function(err, rows) {
      if (err) {
        console.log(err);
        return res.send(500, err);
      }
      var tsvRows = rows.map(function(row) { return [row.reading_date, row.gallons].join('\t') });
      var tsv = ['reading_date\tgallons'].concat(tsvRows);
      //console.log(tsv.join(', '));
      res.setHeader("Content-Type", "text/plain");
      res.send(tsv.join('\n'));
    });
  });
});

spark.login({accessToken: accessToken}).then(
  function(token){
    console.log('Login completed. Token: ', token);
    console.log('Connecting to event stream.');
    spark.getEventStream(false, 'mine', function(event, err) {
      try {
          //console.log("Event: " + JSON.stringify(event));
          if (event.code == "ETIMEDOUT") {
            console.error(Date() + " Timeout error");
          } else {
            eventmodule.handleEvent(event);
          }
        }
        catch(exception) {
            console.log("Exception: " + exception + "\n" + exception.stack);
        }
    });
  },
  function(err) {
    console.log('Login failed: ', err);
  }
);

function update(device) {
  // console.log("Querying " + device.name);
  device.getVariable(variableName).then(
    function(data) {
      // console.log('Got result:', data);
      var deviceID = data.coreInfo.deviceID;
      console.log(device.name + "." + variableName + ": " + data.result + ", " + data.coreInfo.last_heard);
      insertTankReading(deviceID, device.name, data.result, raw2gallons(data.result, deviceID));
    },
    function(err) {
      console.log('An error occurred while getting attrs:', err);
    }
  );
}

function insertTankReading(deviceID, deviceName, rawReading, gallons) {
  db.serialize(function() {
    db.run("INSERT INTO tank_reading (device_id, device_name, reading_date, raw_reading, gallons) VALUES (?, ?, ?, ?, ?)",
        [ deviceID, deviceName, new Date(), rawReading, gallons.toFixed(0) ]);
  });
}

var http = require('http');
var port = process.env.PORT || '3000';
app.set('port', port);
var server = http.createServer(app);
server.listen(port);
console.log('Server started: http://localhost:' + port);
