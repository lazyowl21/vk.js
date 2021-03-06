var http = require('https');
var query = require('querystring');

var express = require('express');

var EventEmitter = require('events');

var request = require('request').defaults({timeout:5000});
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


/**
 * Promisifies request object
 * @param {request} req - The request object
 * @returns {function} - Promisified requset object
 */


function promisifyRequest(req){
	return function(){
		someargs = arguments;		
		return new Promise( (resolve,reject) => {
			function cb( err, resp, body ){
				if(err) return reject(err);
				if(resp.statusCode != 200 ) 
					return reject( httpErr(resp.statusCode, resp.statusMessage) );
				return resolve(body);
			}	
		 	req(...someargs, cb );
		});
	}
}

_apiRequestP = promisifyRequest(_apiRequest);
_oauthRequestP = promisifyRequest( _oauthRequest );

/**
 * VK API Request
 * @param {string} method - Method 
 * @param {object} opts - Method options (including access_token and version)
 */

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

	Object.assign( this, opts );

	this._getCode = this._getCode.bind(this);

	this.setCode = this.setCode.bind(this);
	this.setToken = this.setToken.bind(this);
	this.setServiceToken = this.setServiceToken.bind(this);

	this.requestServiceToken = this.requestServiceToken.bind(this);
	this.requestToken = this.requestToken.bind(this);

	this.token = false;
	this.code = false;
	this.serviceToken = false;

	this.Router = express.Router();
	this.Router.get( '/vkauth' , this._getCode );

	this.on('codeAccepted', this.requestToken );	
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
	
	requestServiceToken(){
		return _oauthRequestP({
			uri:	"access_token",
			qs:	{
				client_id:		this.appid,
				client_secret:		this.appkey,
				grant_type:		"client_credentials",
				v: this.v
				},
			json:	true
			}).then( body => {
				if( 'access_token' in body ) return this.setServiceToken( body.access_token );
				else if( 'error' in body ) throw new VKError( body.error.error_msg );
			}); 				

	}

	requestToken(){
		_oauthRequestP({
			uri:	"access_token",
			qs:	{
				client_id:this.appid,
				client_secret:this.appkey,
				redirect_uri:this.redirect_uri,
				code:this.code		
				}
		}).then( data =>{
			if( 'access_token' in data ) return this.setToken( data );
			else if('error' in data) throw new VKError(data.error.error_msg);	
		});
	}

}

App.prototype.setServiceToken = function( token ){
	this.serviceToken = (this.hideTokens)? true : token;

	this.secureRequest = function( method, opts = {} ){
		opts.access_token = token;
		opts.client_secret = this.appkey;
		return Request( method, opts );
	}.bind(this);

	this.emit('serviceTokenAccepted');
	return this.serviceToken;	
}

App.prototype.setToken = function( auth ){
	if( ! 'access_token' in auth ) throw new Error("No access token presented");
	var token = auth.access_token;
	
	this.token = (this.hideTokens)? true: token;
	
	this.tokenExpired = false;
	this.tokenExpiresIn = auth.expires_in || 0;
	this.tokenExpireTime = new Date( Date.now() + 1000*this.tokenExpiresIn );
	
	if( this.tokenExpiresIn > 0 ) setTimeout( () =>{
		this.token = false;
		this.tokenExpired = true;
		this.emit('tokenExpired');
	}, 1000*this.tokenExpiresIn );

	this.Request = function(method, opts={}){
		opts.access_token = token;
		return Request(method, opts );
	}.bind(this);

	this.emit('tokenAccepted');
	return this.token;
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
