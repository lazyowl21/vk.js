var log4js = require('log4js');
var logger = log4js.getLogger();
logger.setLevel('debug');

var http = require('https');
var query = require('querystring');

var express = require('express');

var EventEmitter = require('events');

var request = require('request').defaults({timeout:20000});
var httpErr = require('http-errors');

var apiv='5.52'
var  codeExpiresIn = 3600*1000;

class VKError extends Error {
	constructor(msg){
		super(msg);
		this.name = 'VKError';
	}
}

var _oauthRequest = request.defaults({
	baseUrl:	"https://oauth.vk.com",
	method:		"POST",
	body:		{},
	json:		true
});

var _apiRequest = request.defaults({
	baseUrl:	"https://api.vk.com/method",
	method:		"POST",
	body:		{},
	json:		true,

	followRedirects: true
});


function errFromResp( resp ){
	return httpErr( resp.statusCode, resp.statusMessage ); 
}

function promisifyRequest(req){
	return function(){
		someargs = arguments;		
		return new Promise( (resolve,reject) => {
			function cb( err, resp, body ){
				if(err) throw err;
				if(resp.statusCode != 200 ) throw errFromResp(resp);
				resolve(body);
			}	
		 	req(...someargs, cb );
		});
	}
}

_apiRequestP = promisifyRequest(_apiRequest);
_oauthRequestP = promisifyRequest( _oauthRequest );

function Request(method, opts = {}){
	return _apiRequestP( {uri: method, qs: opts} )
		.then( body => {
			if('response' in body ) return body.response;
			else if( 'error' in body ) throw new VKError( body.error.error_msg );
		});
}

class App extends EventEmitter{	
	constructor( opts ){
	super();
	
	if( typeof opts !== 'object' ) throw new Error( "Invalid options type: " + typeof opts );
	if(! ('appid' in opts) ) throw new Error( "No app id in options" );

	// default parameters
	this.hideTokens = true;
	this.scope = [];

	this.useSecureRequests = true;

	Object.assign( this, opts );

	this._getCode = this._getCode.bind(this);
	this.setCode = this.setCode.bind(this);
	this.setToken = this.setToken.bind(this);

	this.token = false;
	this.code = false;

	this.on('codeAccepted', this._requestToken );	

	this._serviceToken = false;

	this.Router = express.Router();
	this.Router.get( '/vkauth' , this._getCode );
	
	if( this.useSecureRequests ) this._requestServiceToken( err => {
		if( err )	logger.debug( err );
	});
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
				scope: this.scope,
				response_type:'code'
			});
			res.redirect(redirect); 
		}	
	}
	
	_requestServiceToken(){
		_oauthRequestP({
			uri:	"access_token",
			qs:	{
				client_id:		this.appid,
				client_secret:		this.appkey,
				grant_type:		"client_credentials",
				v: this.v
				},
			json:	true
			}).then( body => {
				if( 'access_token' in body ){
					var token = body.access_token;

					this.serviceToken = (this.hideTokens)? true : token;

					this.secureRequest = function( method, opts = {} ){
						opts.access_token = token;
						opts.client_secret = this.appkey;
						return Request( method, opts );
					}.bind(this);

					this.emit('serviceTokenAccepted');
					return this.serviceToken;
				}
				else if( 'error' in body ) throw new VKError( body.error.error_msg );
		});				

		logger.debug('Requesting service token');
		}

	_requestToken(){
		logger.debug("Requesting token");
		
		_oauthRequestP({
			uri:	"access_token",
			qs:	{
				client_id:this.appid,
				client_secret:this.appkey,
				redirect_uri:this.redirect_uri,
				code:this.code		
				}
		}).then( data =>{
			if( 'access_token' in data ){
				this.setToken( data.access_token, data.expires_in );	
			}
			else if('error' in data){
				throw new VKError(data.error.error_msg);
			}	
		});
	}

}

App.prototype.setToken = function( token, exprsIn = 0 ){
	this.token = (this.hideTokens)? true: token;
	
	this.tokenExpired = false;
	this.tokenExpiresIn = 1000*exprsIn;
	this.tokenExpireTime = new Date( Date.now() + this.tokenExpiresIn );
	
	if( exprsIn > 0 ) setTimeout( () =>{
		this.token = false;
		this.tokenExpired = true;
		this.emit('tokenExpired');
	}, this.tokenExpiresIn );

	this.Request = function(method, opts={}){
		opts.access_token = token;
		return Request(method, opts );
	}.bind(this);

	this.emit('tokenAccepted');
}

App.prototype.setCode = function( code, exprsIn = codeExpiresIn ){
	this.code = code;
	this._codeExpireTime = new Date( Date.now() + exprsIn );
	setTimeout(() => {
		this.code = false;
		this.emit('codeExpired');  
	}, exprsIn ); 
			
	this.emit('codeAccepted');
	return;
}

exports.Request = Request;
exports.App = App;
