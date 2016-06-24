var log4js = require('log4js');
var logger = log4js.getLogger();
logger.setLevel('debug');

var http = require('https');
var query = require('querystring');

var express = require('express');

var EventEmitter = require('events');

var apiv='5.52'
var  codeExpiresIn = 3600*1000;

function requestBody( opts ){
logger.debug('requestBody: request: ', opts);

return new Promise( ( resolve, reject ) => {
	var req = http.request( opts, res => {
		if( res.statusCode != 200 )
			return reject( { code:'HTTP_ERROR', message:res.statusMessage } );

		var databuf = "";
		
		res.on( 'data', chunk => { databuf+=chunk;  } );
		res.on( 'end' , () => {
			logger.debug('requestBody: response: ', databuf.toString('utf8'));
			return resolve( databuf ); 
		});
	});
	req.end();
});
}




function Request(method, opts = {}){
	var reqOpts = {
		hostname:'api.vk.com',
		method:'POST',
		path:'/method/' + method + '?' + query.stringify( opts ) 
	}
	
	return requestBody( reqOpts )
		.then( res => JSON.parse( res.toString('utf8') ) )
		.then( function requestErrHandler( data ) {
			if('response' in data) return data.response;
			else {
				var err = new Error( data.error.error_msg );
				err.name = "VK_ERROR";
				err.code = data.error.error_code;
				err.request_params = data.error.request_params;
				throw  err;
			}
		});
}

function checkToken( token ){
	return Request( "users.get" , {access_token:token} )
		.then( data => {
			if( data.length === 0 ){
				var err = new Error('Token seems to be invalid (empty users.get result)');
				err.name = "VK_ERROR";
				throw err;
			}
			else return data[0].id;
		});	
}

class App extends EventEmitter{	
	constructor( opts ){
	super();
	
	if( typeof opts !== 'object' ) throw new Error( "Invalid options type: " + typeof opts );
	if(! ('appid' in opts) ) throw new Error( "No app id in options" );

	Object.assign( this, opts );

	this._getCode = this._getCode.bind(this);
	this.setCode = this.setCode.bind(this);

	this.token = false;
	this.code = false;

	this._codeExpiresIn = 3600*1000;

	this._serviceToken = false;

	this.Router = express.Router();
	this.Router.get( '/vkauth' , this._getCode );
	
	this._requestServiceToken( err => {
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
				scope:['groups'],
				response_type:'code'
			});
			res.redirect(redirect); 
		}	
	}
	
	_requestServiceToken( cb ){
		logger.debug('Requesting service token');
		requestBody("https://oauth.vk.com/access_token?" + query.stringify({
			client_id:		this.appid,
			client_secret:		this.appkey,
			grant_type:		"client_credentials",
			v:			this.v
		})).then(
			response => {
				var data = {};
				try{
					data = JSON.parse(response.toString('utf8'));
				}
				catch(e){
				}
				if( 'access_token' in data ){
					logger.debug('Service Token found in response');
					this._serviceToken = data.access_token;
					this.secureRequest = function( method, opts = {} ){
						opts.access_token = this._serviceToken;
						opts.client_secret = this.appkey;
						return Request( method, opts );
					}.bind(this);

					this.emit('serviceTokenAccepted');
					return cb( null );
				}
				else if( 'error' in data ){
					logger.debug( data );		
				}
			},

			error => {
				logger.debug("Error caught");
				return cb( error );
			}
 

		);
	
	}

	_requestToken(){
		logger.debug("Requesting token");
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

		requestBody( reqOpts )
			.then( resp => JSON.parse( resp.toString('utf8') ))
			.then( data => {
				if( 'access_token' in data ){
					this.token = data.access_token;

					this.tokenExpired = false;
					this._tokenExpiresIn = 1000*data.expires_in;
					this._tokenExpireTime = new Date( Date.now() + this._tokenExpiresIn);
					
					if(  this._tokenExpiresIn > 0  ) setTimeout( ()=>{
						this.token = false;
						this.tokenExpired = true;
						this.emit('tokenExpired');
					},this._tokenExpiresIn );

					this.Request = function(method, opts={}){
						opts.access_token = this.token;
						return Request(method, opts );
					}.bind(this);

					this.emit('tokenAccepted');
				}
				else if('error' in data){
					var err = new Error( data.error.error_msg );
					err.name = "VK_ERROR";
					err.code = data.error.error_code;
					throw err;
				}
			})
			.catch( err => console.log(err) );
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
