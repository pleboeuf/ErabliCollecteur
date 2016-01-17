//
// Souscrit au événements de tout mes Devices
//
var spark = require('spark');
var token = 'edd81372b36f0c454b71c121e47c38184122af73';
var myDevices =[];
var deviceName = "";
var theTimePart = [];
var theDatePart = [];
var theMilliSecondPart;
var nowDateTime = new Date();

spark.on('login', function() {
    //Get your devices events
    spark.getEventStream(false, 'mine', function(data, err) {
        try {
                console.log("Event: " + JSON.stringify(data));
                if (data.code == "ETIMEDOUT"){
                    console.log(Date() + " Timeout error");
                } else {
                    spark.getDevice(data.coreid, function(err, device){ //First get the name of the device
                        if (err != null){
                            console.log(err);
                        } else {
                            deviceName = device.name;
                            var theDateTime = data.published_at.substr(0, 23);
                            theDatePart = (data.published_at.substr(0, 10)).split("-");
                            theTimePart = (data.published_at.substr(11, 12)).split(":");
                            theMilliSecondPart = theTimePart[2].split(".");
                            // nowDateTime = new Date(theDatePart[0], theDatePart[1] - 1, theDatePart[2], theTimePart[0], theTimePart[1], theMilliSecondPart[0], theMilliSecondPart[1] );
                            nowDateTime = new Date(theDateTime);
                            // console.log(theDateTime + " => " + nowDateTime);
                            // nowDateTime = new Date(nowDateTime.toString().substr(0,24) + " UTC+0000");
                            if (isNaN(Number(data.data))){
                                console.log(theDatePart.toLocaleString() + " - " + theTimePart + " - " + deviceName + " - " + data.name + ": " + data.data);
                            } else {
                                // document.getElementById("CloudData").innerHTML += theDatePart + " - " + theTimePart + " - " + deviceName + " - " + data.name + ": " + Number(data.data).toFixed(1) + "<br>";
                                console.log(nowDateTime.toLocaleString() + " - " + deviceName + " - " + data.name + ": " + Number(data.data).toFixed(1));
                            }
                        }
                    })
            }
        }
        catch(err) {
            console.log("Erreur: " + err);
        }
    });
});
// Login as usual
//spark.login({ username: 'email@example.com', password: 'password'});
spark.login({ accessToken: token });

var devicesPr = spark.listDevices();
devicesPr.then(
  function(devices){
    var x;
    for (x in devices) {
        myDevices[x] = "{" + devices[x].id + ":" + devices[x].name + "}" + ", ";
        console.log(devices[x].id + ":" + devices[x].name);
    }
    // console.log(myDevices);
  },
  function(err) {
    console.log('List devices call failed: ', err);
  }
);
