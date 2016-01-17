//
// Store Spark Core devices raw events
//
var Promise = require('promise');
var http = require('https');
var spark = require('spark');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('raw_events.sqlite3');
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
      var tsvRows = rows.map(function(row) {
        return [row.reading_date, row.gallons].join('\t')
      });
      var tsv = ['reading_date\tgallons'].concat(tsvRows);
      //console.log(tsv.join(', '));
      res.setHeader("Content-Type", "text/plain");
      res.send(tsv.join('\n'));
    });
  });
});

spark.login({
  accessToken: accessToken
}).then(
  function(token) {
    console.log('Login completed. Token: ', token);
    requestReplay();
    console.log('Connecting to event stream.');
    const eventDB = eventmodule.EventDatabase(db);
    spark.getEventStream(false, 'mine', function(event, err) {
      try {
        if (event.code == "ETIMEDOUT") {
          console.error(Date() + " Timeout error");
        } else {
          eventDB.handleEvent(event);
        }
      } catch (exception) {
        console.log("Exception: " + exception + "\n" + exception.stack);
      }
    });
  },
  function(err) {
    console.log('Login failed: ', err);
  }
);

function requestReplay() {
  db.each("select device_id, max(serial_no) as serial_no from raw_events group by device_id", function(err, row) {
    console.log("Requesting replay on " + row.device_id);
    spark.getDevice(row.device_id, function(err, device) {
      device.callFunction('replay', row.serial_no + 1).then(function(err, data) {
        if (err) {
          console.error('Replay request failed:', err);
        } else {
          console.log('Replay request successful:', data);
        }
      });
    });
  });
}

var http = require('http');
var port = process.env.PORT || '3000';
app.set('port', port);
var server = http.createServer(app);
server.listen(port);
console.log('Server started: http://localhost:' + port);
