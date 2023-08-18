module.exports = function(RED) {
    RED.nodes.registerType("icloudjs",icloudDevices);
	let debugMsg = "";
	function icloudDevices(config) {
		RED.nodes.createNode(this,config);
		const ICloud = require('icloudjs').default;
		const path = require("path");
		const getTime = () => {
			now = new Date();
			return (now.getHours() + ":" + (now.getMinutes()<10 ? "0" + now.getMinutes() : now.getMinutes()))
		}
		const Encrypter = require('./encrypt');
		this.encrypter = new Encrypter("bollocks");
		this.devices = [];
		this.icloud = null;
		this.connected = false;
		this.waiting = false;
        var node = this;
		const encryptionKey = process.env.ENCRYPT_KEY || "Not Set";												 
		node.status({fill: "blue", shape: "dot", text: "Ready "});
		this.connect = async function ( user, password ) {
			try {
				this.icloud = new ICloud({
					username: user,
					password: password,
					saveCredentials: false,
					trustDevice: true,
					//dataDirectory: path.resolve('./tmp/')
					dataDirectory: path.resolve('/devices/icloudtrust/')
				});
				await this.icloud.authenticate();
				if (this.icloud.status === "MfaRequested") {
					node.status({fill: "yellow", shape: "ring", text: "Awaiting 2FA Code " + getTime()});
					this.waiting = true;
					//await this.icloud.provideMfaCode("094508")
					return true;
				}
				this.connected = true;
			} catch (er) {
				debugMsg = "[connect] Error Caught " + er
				node.error("[node_icloudjs]" + debugMsg);
				node.status({fill: "red", shape: "ring", text: debugMsg});
				this.connected = false;
				this.waiting = false;
				return {errorMsg: debugMsg, errorCode: er};
			}
			node.status({fill: "green", shape: "dot", text: "Connected " });
			return true;
		}
		node.on('input', async function(msg) {
			const validCommands = ["connect", "disconnect", "refreshDevices", "listDevices", "Send2FA", "alert"];
			if ( ( typeof(msg.payload) != "object"  || !msg.payload.hasOwnProperty("cmd")  || !validCommands.includes(msg.payload.cmd) ) && !validCommands.includes(msg.payload) ) {
				debugMsg = "[onInput][init] Invalid Payload " + msg.payload
				node.error(["[node_icloudjs]" + debugMsg + " should be " + validCommands.join("|"), msg ] );
				node.status({fill: "red", shape: "ring", text: debugMsg});
				return null;
			}
			const cmd = (typeof(msg.payload) == "object") ? msg.payload.cmd : msg.payload;
			if ( cmd == "connect" ) {
				if (!msg.password || !msg.user ) {
					debugMsg = "[onInput][" + cmd + "]" + " requires msg.password, msg.user  to be set"
					node.error(["[node_icloudjs]" + debugMsg, msg ] );
					node.status({fill: "red", shape: "ring", text: debugMsg});
					return null;
				}
				const connectResult = await this.connect(msg.user, msg.password);
				if (this.connected) {
					node.send( { topic: "icloud_connected", payload: Object.values(this.devices) } )
				} else if (this.waiting) {
					node.send( { topic: "icloud_MfaRequested", payload: {errorMsg: "", errorCode: 0 } } );
				} else {
					node.send( { topic: "icloud_error", payload: {errorMsg: connectResult.errorMsg || "Unknown", errorCode: connectResult.errorCode || 999 } } );
				}
			} else if ( cmd == "Send2FA" ) {
				if ( typeof(msg.payload) != "object"  || !msg.payload.hasOwnProperty("icloud_number")  || !this.waiting ) {
					debugMsg = "[onInput][" + cmd + "]" + " msg.icloud_number to be set";
					if (!this.waiting) debugMsg = debugMsg + " unexpected 2FA";
					node.error(["[node_icloudjs]" + debugMsg, msg ] );
					node.status({fill: "red", shape: "ring", text: debugMsg});
					return null;
				}
				try {
					await this.icloud.provideMfaCode(msg.payload.icloud_number);
					await this.icloud.awaitReady;
					this.waiting = false;
					this.connected = true;
					debugMsg = "icloud authenticated for account " + this.icloud.accountInfo.dsInfo.fullName
					node.warn(["[node_icloudjs]" + debugMsg, this.icloud ] );
				} catch(er) {
					debugMsg = "[onInput][" + cmd + "]" + " caught error in provideMfaCode " + er;
					node.error(["[node_icloudjs]" + debugMsg, msg ] );
					node.status({fill: "red", shape: "ring", text: debugMsg});
					node.send( { topic: "icloud_error", payload: {errorMsg: debugMsg, errorCode: er } } );
					return null;
				}
			} else if ( cmd == "refreshDevices" || cmd == "listDevices" ) {
				if (!this.connected) {
					if (!msg.password || !msg.user || !msg.ip) {
						debugMsg = "[onInput][" + cmd + "]" + " Not connected";
						node.error(["[node_icloudjs]" + debugMsg, msg ] );
						node.status({fill: "red", shape: "ring", text: debugMsg});
						return null;
					}
					node.warn("[icloud_devices][" + cmd +"] Not connected - will attempt to connect")
					const connectResult = await this.connect(msg.user, msg.password);
					if (!this.connected) {
						debugMsg = "[" + cmd + "]" + " Not connected " + (connectResult.errorMsg || "");
						node.error(["[node_icloudjs]" + debugMsg, msg ] );
						node.status({fill: "red", shape: "ring", text: debugMsg});
						if (this.waiting) {
							node.send( { topic: "icloud_MfaRequested", payload: {errorMsg: "", errorCode: 0 } } );
						} else {
							node.send( { topic: "icloud_error", payload: {errorMsg: debugMsg, errorCode: connectResult.errorCode || 999 } } );
						}
						return null;
					}
				}
				try {
					const findMyService = this.icloud.getService("findme");
					await findMyService.refresh();
					this.devices = [];
					for (let device of findMyService.devices.values()) {
						this.devices.push({
							id: device.deviceInfo.id,
							name: device.deviceInfo.name,
							uniqueName: device.deviceInfo.name + "[" + device.deviceInfo.rawDeviceModel + "]",
							modelDisplayName: device.deviceInfo.modelDisplayName,
							isConsideredAccessory: device.deviceInfo.isConsideredAccessory,
							deviceModel: device.deviceInfo.deviceModel,
							rawDeviceModel: device.deviceInfo.rawDeviceModel,
							batteryLevel: device.deviceInfo.batteryLevel,
							batteryStatus: device.deviceInfo.batteryStatus,
							"location": device.deviceInfo.location
						});
					}
				} catch (er) {
					debugMsg = "[" + cmd + "]" + " status=" + this.icloud.status + " Error caught " + er;
					node.error(["[node_icloudjs]" + debugMsg, msg ] );
					node.status({fill: "red", shape: "ring", text: debugMsg});
					node.send( { topic: "icloud_error", payload: {errorMsg: debugMsg, errorCode: er } } );
					return null;
				}
				node.send( { topic: "icloud_devices_" + cmd, payload: this.devices } );
				node.status({fill: "green", shape: "dot", text: cmd + " - returned " + this.devices.length + " devices"});
			} else if ( cmd == "alert" ) {
				if ( typeof(msg.payload) != "object"  || (!msg.payload.hasOwnProperty("deviceID") && !msg.payload.hasOwnProperty("deviceName") ) ){
					debugMsg = "[onInput][" + cmd + "]" + " requires either msg.deviceID or msg.deviceName to be set";
					node.error(["[node_icloudjs]" + debugMsg, msg ] );
					node.status({fill: "red", shape: "ring", text: debugMsg});
					return null;
				}
				const devID = (msg.payload.deviceID) ? msg.payload.deviceID : this.devices.find( dv => msg.payload.deviceName == dv.uniqueName )?.id ;;
				if (!this.devices.find( dv => devID == dv.id )) {
					debugMsg = "[onInput][" + cmd + "]" + ( (msg.payload.deviceID) ? " deviceID=" + msg.payload.deviceID : "" ) + ( (msg.payload.deviceName) ? " Name=" + msg.payload.deviceName : "" ) + " Not in list"
					node.error(["[node_icloudjs]" + debugMsg, this.devices, devID, msg ] );
					node.status({fill: "red", shape: "ring", text: debugMsg});
					return null;
				}
				try {
					const findMyService = this.icloud.getService("findme");
					await findMyService.alert( devID, (msg.payload.subject || undefined) );
				} catch(er) {
					debugMsg = "[" + cmd + "]" + "Alerting Error caught " + er;
					node.error(["[node_icloudjs]" + debugMsg, msg ] );
					node.status({fill: "red", shape: "ring", text: debugMsg});
					node.send( { topic: "icloud_error", payload: {errorMsg: debugMsg, errorCode: er } } );
					return null
				}
			} else if ( cmd == "disconnect" ) {
				if (!this.icloud) {
					debugMsg = "[onInput][" + cmd + "]" + " Not connected";
					node.error(["[node_icloudjs]" + debugMsg, msg ] );
					node.status({fill: "red", shape: "ring", text: debugMsg});
					return null
				}
				this.connected = false;
				this.icloud = null;
				node.send( { topic: "icloud_disconnected", payload: {errorMsg: "", errorCode: 0 } } );
				node.status({fill: "yellow", shape: "dot", text: "Closed"});
			}

        });
		node.on('close', async function(removed, done) {
			if (this.icloud) {
				node.warn("[node_icloudjs][onClose] Closing icloud");
				this.icloud = null
			} else {
					node.warn("[node_icloudjs][onClose]" + "icloud does not exist so no need to close")
			}
			node.send( { topic: "icloud_closed", payload: {errorMsg: "", errorCode: 0 } } );
			done();
		});
    }
}