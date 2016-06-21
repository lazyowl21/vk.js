var log4js = require('log4js');
var logger = log4js.getLogger();
logger.setLevel('debug');

var http = require('https');
var query = require('querystring');

var express = require('express');

var EventEmitter = require('events');

var apiv='5.52'
var  codeExpiresIn = 3600*1000;


function Request(method, opts = {}, token=false, v=apiv){

	if(token) opts.access_token = token;
	opts.v = v;
	var reqOpts = {
		hostname:'api.vk.com',
		method:'POST',
		path:'/method/' + method + '?' + query.stringify( opts ) 
	}

	return new Promise( (resolve, reject)=>{
		var datastr = "";
		var req = http.request( reqOpts, (res) => {

			if( res.statusCode != 400 ){
				reject({ code: 'HTTP_ERROR', message: res.statusMessage } );
				return;
			}
			res.on('data',  chunk => {
				datastr+=chunk;
			});
			res.on('end', ()=>{
				var data_json = JSON.parse(datastr.toString('utf8'));
				if( 'response' in data_json ){ 
					resolve( data_json.response );
				}
				else if('error' in data_json ){ 
					reject( data_json.error  );
				}
				else{
					reject( { code:'UNKNOWN_ERROR' } ); 			}
			}); 
		});
		req.end();	

	});
}



class App extends EventEmitter{	
	constructor( opts ){
	super();
	
	if( typeof opts !== 'object' ) throw new Error( "Invalid options type: " + typeof opts );
	if(! ('appid' in opts) ) throw new Error( "No app id in options" );

	this.appid = opts.appid;
	this.appkey = opts.appkey;
	this.host = opts.host;

	this._getCode = this._getCode.bind(this);
	this.setCode = this.setCode.bind(this);

	this.token = false;
	this.code = false;

	this._codeExpiresIn = 3600*1000;

	this._serviceToken = false;

	this.Router = express.Router();
	this.Router.get( '/vkauth' , this._getCode );

	}
	
	_getCode(req, res){
		if( 'code' in req.query ){
			this.setCode( req.query.code );
			res.end("Code Accepted");
		}
		else {
			var redirect_back = this.host + req.path
			this.redirect_uri = redirect_back;

			var redirect = "https://oauth.vk.com/authorize?" + query.stringify({
				client_id:this.appid,
				display:'page',
				redirect_uri:redirect_back,
				scope:['groups','offline'],
				response_type:'code'
			});
			res.redirect(redirect); 
		}	
	}
	
	_requestServiceToken(){
		var reg = http.get("https://oauth.vk.com/access_token?" + query.stringify({
			client_id:		this.appid,
			client_secret:		this.appkey,
			grant_type:		"client_credentials",
			v:			this.v
		}), res => {
			var datastr = "";
			
			res.on('data', chunk => {
				datastr += chunk;
			});
			res.on('end', () => {
			
				var data_json = JSON.parse( datastr.toString('utf'));
				
				if(! ('access_token' in data_json) ){
					this.emit('serviceTokenReqError');
					return;
				}

				this._serviceToken = data_json.access_token;
				this.secureRequest = function( method, opts={}, v=apiv ){
					opts.client_secret = this.appkey;
					return Request( method, opts, this._serviceToken, v );
				}.bind(this);

				this.emit('serviceTokenAccepted');
				return;
			});
		}); 
	}

	_requestToken(){
		var reqOpts = {
			host:'oauth.vk.com',
			method:'GET',
			path:'/access_token?' + query.stringify({
				client_id:this.appid,
				client_secret:this.appkey,
				redirect_uri:this.redirect_uri,
				code:this.code
			})
		};

		var reg = http.request( reqOpts, res => {
			var datastr = "";
			logger.debug("Response code:",res.statusCode );
			if( res.statusCode != 200 ){
				this.code = false;
				this.emit('httpError', {code:res.statusCode, message:res.statusMessage});
				return;
			}
			res.on('data', chunk => {
				datastr += chunk;
			});
			res.on('end', () => {
				try {
					var data_json =  JSON.parse(datastr.toString('utf8'));
				}
				catch(e){
					data_json = {};	
				}

				if( 'access_token' in data_json ){
					this.token = data_json.access_token;

					this.tokenExpired = false;
					this._tokenExpiresIn = 1000*data_json.expires_in;
					this._tokenExpireTime = new Date( Date.now() + this._tokenExpiresIn);
					
					if(  this._tokenExpiresIn > 0  ) setTimeout( ()=>{
						this.token = false;
						this.tokenExpired = true;
						this.emit('tokenExpired');
					},this._tokenExpiresIn );

					this.Request = function(method, opts={}, v=apiv){
						return Request(method, opts, this.token, v );
					}.bind(this);

					this.emit('tokenAccepted');
				}	
				else if( 'error' in data_json ){
					this.code = false;
					this.emit('tokenError', data_json);
				}
				else {
					this.emit('unknownError');
				}
			});
			
		});

		reg.end();	
	}



}



App.prototype.setCode = function( code, exprsIn = codeExpiresIn ){
	this.code = code;
	this._codeExpireTime = new Date( Date.now() + exprsIn );
	setTimeout(() => {
		this.code = false;
		this.emit('codeExpired');  
	}, exprsIn ); 
			
	this.emit('codeAccepted');
	
	this._requestToken();
	return;
}

exports.Request = Request;
exports.App = App;
