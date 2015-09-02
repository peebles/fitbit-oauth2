# Fitbit OAuth2

Client library to support interfacing with the Fitbit API using OAuth2.

This library implements the Authorization Code Grant Flow for Fitbit.  Specifically, this flow
allows a browser-less server to make Fitbit API calls using a persisted token.  The initial
user authorization must be done in a browser environment.  If the token returned is persisted
(to a database for example), then subsequent API calls may be made on behalf of the user by
webserver or by non-webserver code.  This library automatically handles token refreshes.

## Usage Example

### In a webapp

    var express = require('express');
    var app     = express();
    var config  = require( './config/app.json' );
    var fs      = require( 'fs' );
    
    var Fitbit  = require( 'fitbit-oauth2' );
    
    // Simple token persist functions.
    //
    var tfile = 'fb-token.json';
    var persist = {
        read: function( filename, cb ) {
            fs.readFile( filename, { encoding: 'utf8', flag: 'r' }, function( err, data ) {
                if ( err ) return cb( err );
                try {
                    var token = JSON.parse( data );
                    cb( null, token );
                } catch( err ) {
                    cb( err );
                }
            });
        },
        write: function( filename, token, cb ) {
            console.log( 'persisting new token:', JSON.stringify( token ) );
            fs.writeFile( filename, JSON.stringify( token ), cb );
        }
    };
    
    // Instanciate a fitbit client.  See example config below.
    //
    var fitbit = new Fitbit( config.fitbit ); 
    
    // In a browser, http://localhost:4000/fitbit to authorize a user for the first time.
    //
    app.get('/fitbit', function (req, res) {
        res.redirect( fitbit.authorizeURL() );
    });
    
    // Callback service parsing the authorization token and asking for the access token.  This
    // endpoint is refered to in config.fitbit.authorization_uri.redirect_uri.  See example
    // config below.
    //
    app.get('/fitbit_auth_callback', function (req, res, next) {
        var code = req.query.code;
        fitbit.fetchToken( code, function( err, token ) {
            if ( err ) return next( err );
            
            // persist the token
            persist.write( tfile, token, function( err ) {
                if ( err ) return next( err );
                res.redirect( '/fb-profile' );
            });
        });
    });
    
    // Call an API.  fitbit.request() mimics nodejs request() library, automatically
    // adding the required oauth2 headers.  The callback is a bit different, called
    // with ( err, body, token ).  If token is non-null, this means a refresh has happened
    // and you should persist the new token.
    //
    app.get( '/fb-profile', function( req, res, next ) {
        fitbit.request({
            uri: "https://api.fitbit.com/1/user/-/profile.json",
            method: 'GET',
        }, function( err, body, token ) {
            if ( err ) return next( err );
            var profile = JSON.parse( body );
            // if token is not null, a refesh has happened and we need to persist the new token
            if ( token )
                persist.write( tfile, token, function( err ) {
                    if ( err ) return next( err );
                        res.send( '<pre>' + JSON.stringify( profile, null, 2 ) + '</pre>' );
                });
            else
                res.send( '<pre>' + JSON.stringify( profile, null, 2 ) + '</pre>' );
        });
    });
    
    app.listen(4000);

### Outside of a webapp

Once a token has been persisted, you can write non-webapp code to call Fitbit APIs.  When
the token expires, this library will automatically refresh the token and carry on.  Here's
an example:

    var config = require( './config/app' );
    var fs     = require( 'fs' );
    var Fitbit = require( 'fitbit-oauth2' );
    
    // Simple token persist code
    //
    var tfile = 'fb-token.json';
    var persist = {
        read: function( filename, cb ) {
            fs.readFile( filename, { encoding: 'utf8', flag: 'r' }, function( err, data ) {
                if ( err ) return cb( err );
                try {
                    var token = JSON.parse( data );
                    cb( null, token );
                } catch( err ) {
                    cb( err );
                }
            });
        },
        write: function( filename, token, cb ) {
            console.log( 'persisting new token:', JSON.stringify( token ) );
            fs.writeFile( filename, JSON.stringify( token ), cb );
        }
    };
    
    // Instanciate the client
    //
    var fitbit = new Fitbit( config.fitbit );
    
    // Read the persisted token, initially captured by a webapp.
    //
    persist.read( tfile, function( err, token ) {
        if ( err ) {
            console.log( err );
            process.exit(1);
        }
    
        // Set the client's token
        fitbit.setToken( token );
    
        // Make an API call
        fitbit.request({
            uri: "https://api.fitbit.com/1/user/-/profile.json",
            method: 'GET',
        }, function( err, body, token ) {
            if ( err ) {
                console.log( err );
                process.exit(1);
            }
            console.log( JSON.stringify( JSON.parse( body ), null, 2 ) );
    
            // If the token arg is not null, then a refresh has occured and
            // we must persist the new token.
            if ( token )
                persist.write( tfile, token, function( err ) {
                if ( err ) console.log( err );
                    process.exit(0);
                });
            else
                process.exit(0);
        });
    });

## Configuration

An example configuration file:

    {
        "fitbit": {
            "timeout": 10000,
            "creds": {
                "clientID": "YOUR-CIENT-ID",
                "clientSecret": "YOUR-CLIENT-SECRET"
            },
            "uris": {
                "authorizationUri": "https://www.fitbit.com",
                "authorizationPath": "/oauth2/authorize",
                "tokenUri": "https://api.fitbit.com",
                "tokenPath": "/oauth2/token"
            },
            "authorization_uri": {
                "redirect_uri": "http://localhost:4000/fitbit_auth_callback/",
                "response_type": "code",
                "scope": "activity nutrition profile settings sleep social weight heartrate",
                "state": "3(#0/!~"
            }
        }
    }

## Token Storage

A token is a JSON blob, and looks like this:

    {
        "access_token": ACCESS_TOKEN,
        "expires_in": SECONDS,
        "expires_at": "20150829T10:20:25",
        "refresh_token": REFRESH_TOKEN
    }

## API

#### `new Fitbit( config )`
Constructor.  See example config above.

#### `new Fitbit( config, persistTokenCB )`
Alternative constructor.  If called with a function as the second parameter, that function will be called when
a new token has been fetched as the result of a token refresh.  The function is called with the new token (as
a JSON struct) and a callback.  When the function is finished it should call the callback.  Example:

    var fitbit = new Fitbit( config, function( token, cb ) {
        saveToken( JSON.stringify( token ), function( err ) {
            if ( err ) return cb( err );
            cb();
        });
    });

#### `setToken( token )`
Set the client token.  The client token must be set before a call to request() is made.  In a webapp,
the client token will be set when initial authorization happens.  In a non-webapp, you must obtain
the token from persistent storage and call this method.

#### `getToken()`
Returns the client token if it has been set, null otherwise.

#### `authorizeURL()`
Used in a webapp to get the authorization URL to start the OAuth2 handshake.  Typical usage:

    app.get( '/auth', function( req, res ) {
        res.redirect( fitbit.authorizeURL() );
    });

#### `fetchToken( code, cb )`
Used in a webapp to handle the second step of OAuth2 handshake, to obtain the token from Fitbit.  See
example above for usage.

#### `request( options, cb )`
Call a Fitbit API.  The options structure is the same as nodejs request library and in fact is passed
almost strait through to request().  The cb() is called with (err, body, token).  If token is not
null, then it means that a token refresh has happened and you should persist the new token.

#### `getLimits()`
After a call to request(), you can make this call to get the Fitbit API limits returned in the
response headers.  This will look something like:

    {
        "limit": "150",
        "remaining": "146",
        "reset": "932"
    }

