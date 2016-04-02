var CONSTANTS = require('./constants.js');
var _ = require('underscore');

var Feather = function(peripheral, verbose){

	/*
		VARIABLES
	*/
	// Reference to "this"
	var _self = this;

	// Should console.logs be printed out
	this._verbose = verbose;

	// Noble Peripheral Object
	this._peripheral = peripheral;

	// Incoming Characteristic
	this._read;

	// inputBuffer String
	this._inputBuffer = "";

	// The last full message recieved
	this._lastMessage;

	// Outgoing Characteristic
	this._write;

	// If wearable is ready
	this._ready = false;

	// Listener Event callbacks
	this._listeners = {
		// When wearable is connected and ready
		"ready": [],

		// When a user disconnects
		"disconnect": [],

		// When the wearable sends any message back
		"message": []
	};


	/*
		METHODS
	*/
	this.on = function(event, callback){
		_self._listeners[event].push(callback);
	};

	// Connects, finds read/white characteristics, grabs the userID from the arduino, and triggers "ready" listeners
	this.setup = function(){

		_self._peripheral.connect(function(err){

			if (err != null) {
				if (_self._verbose){
					console.log("\tCould not connect.\n\n");
					console.log(err);
				}
				return;
			}

			if (_self._verbose){
				console.log("\tConnected!\n\n");
			}

			_self._peripheral.once('disconnect', function(){
				if (_self._verbose){
					console.log("\n\nPeripheral disconnected.");
				}

				// Trigger disconnect callbacks
				_.each(_self._listeners.disconnect, function(callback){
					callback();
				});

			});

			_self._peripheral.discoverServices([CONSTANTS.UART_SERVICE_UUID], function(err, services){

				if (err != null) {
					if (_self._verbose){
						console.log("\tError recieving services.\n\n");
						console.log(err);
					}
					return;
				}

				if (services.length < 1) {
					if (_self._verbose){
						console.log("\tCould not get service(s).\n\n");
					}
					return;
				}


				var characteristicUUIDs = [CONSTANTS.READ_CHARACTERISTIC_UUID, CONSTANTS.WRITE_CHARACTERISTIC_UUID];

				services[0].discoverCharacteristics(characteristicUUIDs, function(err, characteristics){

					if (err != null || characteristics.length < 1) {
						if (_self._verbose){
							console.log("\tCould not get characteristics for service "+service.uuid+".\n\n");
						}
						// console.log("\t" + err);
						return;
					}

					if (_self._verbose){
						console.log("\tCharacteristics found ("+characteristics.length+").\n\n");
					}

					// console.log(characteristics);

					_.each(characteristics, function(characteristic){

						if (characteristic.uuid == CONSTANTS.READ_CHARACTERISTIC_UUID){
							if (_self._verbose){
								console.log("Setting listener for data notification on characteristic "+characteristic.uuid);
							}

							characteristic.on('read', function(data, isNotification){
								//console.log("From read.");
								_self.dataRecieved(characteristic, data, isNotification);
							});

							if (_self._verbose){
								console.log("Trying to subscribe to characteristic "+characteristic.uuid+"...");
							}
							characteristic.notify(true, function(err){

								if (err != null) {
									if (_self._verbose){
										console.log("\tError subscribing.\n\n");
										console.log("\t", err);
									}
									return checkSetupStatus(err);
								}

								if (_self._verbose){
									console.log("\tSubscribed.\n\n");
								}
								_self._read = characteristic;
								checkSetupStatus();
							});
						}

						if (characteristic.uuid == CONSTANTS.WRITE_CHARACTERISTIC_UUID){
							_self._write = characteristic;
							checkSetupStatus();
						}
					});
				});
			});
		});

		function checkSetupStatus(err){

			if (err) {
				_.each(_self._listeners.ready, function(callback){
					callback(err);
				});
			}

			if (_self._read != null && _self._write != null) {

				_self._ready = true;

				// Trigger ready callbacks
				_.each(_self._listeners.ready, function(callback){
					callback();
				});
			}
		}
	};

	// Send a message (String) to this wearable with a callback on completion
	this.sendMessage = function(msg, callback){

		if (msg[msg.length] != CONSTANTS.MESSAGE_TERMINATOR) msg += CONSTANTS.MESSAGE_TERMINATOR;

		var messages = chunkString(msg, CONSTANTS.BLE_MAX_CHUNK_SIZE);
		var goalLength = messages.length;

		var sentMessages = {};

		_.each(messages, function(message, index, list){
			(function(msg, i){

				var msgBuffer = new Buffer(msg, "utf-8");
				var key = i.toString();

				sentMessages[key] = {};

				//console.log("SentMessages:", sentMessages);

				_self._write.write(msgBuffer, true, function(err){
					if (err) {
						if (_self._verbose){
							console.log("\tError sending message.\n\n");
							console.log("\t", err);
						}

						sentMessages[key].wasSent = true;
						sentMessages[key].hasError = true;
						sentMessages[key].error = err;

						return checkStatus();
					}

					//console.log("\tMessage sent: "+i+"\n\n");

					sentMessages[key].wasSent = true;
					sentMessages[key].hasError = false;
					sentMessages[key].error = null;

					return checkStatus();
				});
			})(message, index);
		});

		function checkStatus() {

			var numSent = 0;

			var wasError;

			for (var prop in sentMessages) {
				if (sentMessages[prop].wasSent) numSent++;

				if (sentMessages[prop].hasError) wasError = sentMessages[prop].error;
			}

			if (numSent == goalLength) {

				if (callback) return callback(wasError);

			}
		}

		// SOURCE: http://stackoverflow.com/questions/7033639/split-large-string-in-n-size-chunks-in-javascript
		function chunkString(str, length) {
			return str.match(new RegExp('.{1,' + length + '}', 'g'));
		}
	};

	this.dataRecieved = function(characteristic, data, isNotification){
		if (_self._verbose){
			console.log("\nData Recieved:");
			console.log("\tCharacteristic: " + characteristic.uuid);
			console.log("\tNotification: " + isNotification);
			console.log("\tData: " + data + "\n");
		}

		for (var i = 0; i < data.length; i++){
			var c = String.fromCharCode(data[i]);

			// console.log("Recieved: " + c);

			if (c == CONSTANTS.MESSAGE_TERMINATOR) {

				_self._lastMessage = _self._inputBuffer;

				_self._inputBuffer = "";

				// Trigger message callbacks
				_.each(_self._listeners.message, function(callback){
					callback(_self._lastMessage);
				});
			}
			else {
				_self._inputBuffer += c;
			}
		}
	};

	this.isFeather = function(peripheral){
		// if ((peripheral.id == WEARABLE_PERIFERAL_ID || peripheral.advertisement.localName == WEARABLE_LOCAL_NAME) && _.contains(peripheral.advertisement.serviceUuids, CONSTANTS.UART_SERVICE_UUID)) {
		if (_.contains(peripheral.advertisement.serviceUuids, CONSTANTS.UART_SERVICE_UUID)) {
			return true;
		}

		return false;
	};

};

module.exports = Feather;