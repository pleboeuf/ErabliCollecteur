//
// Poll Spark Core devices for tank level readings.
//
var http = require('https');
var fs = require('fs');
var spark = require('spark');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('erablipi.sqlite3');
var express = require('express');
var path = require('path');
var variableName = "dist";
var tankLevelFile = "public/tank-levels.csv";
var accessToken = process.env.ACCESS_TOKEN;
var app = express();
app.use(app.router);
app.use(express.logger());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', express.static(path.join(__dirname, 'index.html')));

spark.login({accessToken: accessToken}).then(
  function(token){
    console.log('Login completed. Token: ', token);
    
    var tankIds = [
      process.env.TANK_1_DEVICE_ID,
      process.env.TANK_2_DEVICE_ID];

    console.log("Getting " + tankIds.length + " tank devices: " + tankIds);
    tankIds.map(function(id) {
      return spark.getDevice(id).then(function(dev) { return [dev]; });
    } ).reduce(joinPromises).then(function(tanks) {
      console.log("Got " + tanks.length + " tank devices");
      var queryDevices = function() {
        tanks.forEach(function(tank) {
          update(tank);
        });
        setTimeout(queryDevices, 5000);
      }
      queryDevices();
    });
  },
  function(err) {
    console.log('Login failed: ', err);
  }
);

function update(device) {
  //console.log("Querying " + device.name);
  device.getVariable(variableName).then(
    function(data) {
      //console.log('Got result:', data);
      var deviceID = data.coreInfo.deviceID;
      console.log(device.name + "." + variableName + ": " + data.result);
      insertTankReading(deviceID, device.name, data.result, -1);
      appendTankReadingCSV(deviceID, device.name, data.result, -1);
    },
    function(err) {
      console.log('An error occurred while getting attrs:', err);
    }
  );
}

function insertTankReading(deviceID, deviceName, rawReading, gallons) {
  db.serialize(function() {
    db.run("INSERT INTO tank_reading (device_id, device_name, reading_date, raw_reading, gallons) VALUES (?, ?, ?, ?, ?)",
        [ deviceID, deviceName, new Date(), rawReading, gallons ]);
  });
}

function appendTankReadingCSV(deviceID, deviceName, rawReading, gallons) {
  var timestamp = new Date().getTime();
  fs.appendFile(tankLevelFile, ["" + timestamp, deviceName, rawReading, gallons].join("\t") + "\n", function(err) {
    if (err) {
      console.log(err);
    }
  });
}
    
function joinPromises(prev, cur, i, a) {
  return prev.then(function(a) {
    return cur.then(function(b) {
      return a.concat(b);
    });
  });
};

var http = require('http');
var port = process.env.PORT || '3000';
app.set('port', port);
var server = http.createServer(app);
server.listen(port);
console.log('Server started: http://localhost:' + port);

