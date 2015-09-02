var request = require( 'request' );
var moment  = require( 'moment' );
var async = require( 'async' );

/*
  var Fitbit = require( './lib/Fitbit' );

  function persistToken( token, cb ) {
      fs.writeFile( 'token.json', JSON.stringify( token ), cb );
  }

  var fitbit = new Fitbit( config, persistToken );

  // fetch a token from persistent storage.  if it exists in storage:
  fitbit.setToken( token );

  // In an express app:

  app.get( '/auth', function( req, res ) {
      if ( fitbit.getToken() )
          res.redirect( '/profile' );
      else
          res.redirect( fitbit.authorizeURL() );
  });

  app.get( '/auth_callback', function( req, res, next ) {
      var code = req.query.code;
      fitbit.fetchToken( code, function( err, token ) {
          if ( err ) return next( err );
	  res.redirect( '/profile' );
      });
  });

  // fitbit.request() can be done outside of a web app context, so
  // long as a token is available and fitbit.setToken( token ) was
  // called.  fitbit.request() will automatically refresh the token
  // when required.
  //
  app.get( '/profile', function( req, res, next ) {
    fitbit.request({
        uri: "https://api.fitbit.com/1/user/-/profile.json",
	method: 'GET',
    }, function( err, body ) {
        if ( err ) return next( err );
	var profile = JSON.parse( body );
	res.jsonp( profile );
    });
  });

  DATA STRUCTURES:

  token = {
      "access_token": ACCESS_TOKEN,
      "expires_in": SECONDS,
      "expires_at": "20150829T10:20:25",
      "refresh_token": REFRESH_TOKEN
  }

  config = {
	"creds": {
	    "clientID": ID,
	    "clientSecret": SECRET,
	},
	"uris": {
	    "authorizationUri": "https://www.fitbit.com",
	    "authorizationPath": "/oauth2/authorize",
	    "tokenUri": "https://api.fitbit.com",
	    "tokenPath": "/oauth2/token"
	},
	"authorization_uri": {
	    "redirect_uri": "http://localhost:3000/auth_callback/",
	    "response_type": "code",
	    "scope": "activity nutrition profile settings sleep social weight heartrate",
	    "state": "3(#0/!~"
	}
  }
*/

var Fitbit = function( config, persist ) {
    this.config = config;
    this.token  = null;
    this.persist = persist;
    if ( ! this.config.timeout ) this.config.timeout = 60 * 1000; // default 1 minute
}

Fitbit.prototype.authorizeURL = function() {
    return require('simple-oauth2')({
	clientID: this.config.creds.clientID,
	clientSecret: this.config.creds.clientSecret,
	site: this.config.uris.authorizationUri,
	authorizationPath: this.config.uris.authorizationPath,
    }).authCode.authorizeURL( this.config.authorization_uri );
}

Fitbit.prototype.fetchToken = function( code, cb ) {
    var self = this;
    request({
        uri: self.config.uris.tokenUri + self.config.uris.tokenPath,
        method: 'POST',
        headers: { Authorization: 'Basic ' +  new Buffer(self.config.creds.clientID + ':' + self.config.creds.clientSecret).toString('base64') },
	timeout: self.config.timeout,
        form: {
            code: code,
            redirect_uri: self.config.authorization_uri.redirect_uri,
            grant_type: 'authorization_code',
            client_id: self.config.creds.clientID,
            client_secret: self.config.creds.clientSecret,
        }
    }, function( err, res, body ) {
	if ( err ) return cb( err );
	try {
	    var token = JSON.parse( body );
	    token.expires_at = moment().add( token.expires_in, 'seconds' ).format( 'YYYYMMDDTHH:mm:ss' );
	    self.token = token;
	    if ( ! self.persist ) cb( null, token );
	    self.persist( self.token, function( err ) {
		if ( err ) return cb( err );
		cb( null, token );
	    });
	} catch( err ) {
	    cb( err );
	}
    });
}

Fitbit.prototype.setToken = function( token ) {
    this.token = token;
}

Fitbit.prototype.getToken = function( token ) {
    return this.token;
}

Fitbit.prototype.refresh = function( cb ) {
    var self = this;
    request({
        uri: self.config.uris.tokenUri +  self.config.uris.tokenPath,
        method: 'POST',
        headers: { Authorization: 'Basic ' +  new Buffer(self.config.creds.clientID + ':' + self.config.creds.clientSecret).toString('base64') },
	timeout: self.config.timeout,
        form: {
            grant_type: 'refresh_token',
            refresh_token: self.token.refresh_token
        }
    }, function( err, res, body ) {
        if ( err ) return cb( new Error( 'token refresh: ' + err.message ) );
	try {
            var token = JSON.parse( body );
            token.expires_at = moment().add( token.expires_in, 'seconds' ).format( 'YYYYMMDDTHH:mm:ss' );
	    self.token = token;
	    if ( ! self.persist ) return cb( null, token );
	    self.persist( self.token, function( err ) {
		if ( err ) return cb( err );
		cb( null, token );
	    });
	} catch( err ) {
	    cb( err );
	}
    });
}

// The callback gets three params: err, body, token.  If token is not null, that
// means a token refresh was performed, and the token is the new token.  If tokens
// are persisted by the caller, the caller should persist this new token.  If the
// token is null, then a refresh was not performed and the existing token is still valid.
//
Fitbit.prototype.request = function( options, cb ) {
    var self = this;

    if ( ! self.token )
	return cb( new Error( 'must setToken() or getToken() before calling request()' ) );

    if ( ! self.token.access_token )
	return cb( new Error( 'token appears corrupt: ' + JSON.stringify( self.token) ) );

    async.series([
	function( cb ) {
	    if ( moment().unix() >= moment( self.token.expires_at, 'YYYYMMDDTHH:mm:ss' ).unix() )
		self.refresh( cb );
	    else
		cb();
	},
	function( cb ) {
	    if ( ! options.auth ) options.auth = {};
	    if ( ! options.timeout ) options.timeout = self.config.timeout;
	    options.auth.bearer = self.token.access_token;
	    request( options, function( err, res, body ) {
		if ( err ) return cb( new Error( 'request: ' + err.message ) );
		self.limits = {
		    limit: res.headers[ 'fitbit-rate-limit-limit' ],
		    remaining: res.headers[ 'fitbit-rate-limit-remaining' ],
		    reset: res.headers[ 'fitbit-rate-limit-reset' ],
		};
		cb( null, body );
	    });
	},
    ], function( err, results ) {
	if ( err ) return cb( err );
	cb( null, results[1], results[0] );
    });
}

Fitbit.prototype.getLimits = function() {
    return this.limits;
}

module.exports = Fitbit;
