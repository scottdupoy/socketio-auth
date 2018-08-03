'use strict';

var _ = require('lodash');
var debug = require('debug')('socketio-auth');

/**
 * Adds connection listeners to the given socket.io server, so clients
 * are forced to authenticate before they can receive events.
 *
 * @param {Object} io - the socket.io server socket
 *
 * @param {Object} config - configuration values
 * @param {Function} config.authenticate - indicates if authentication was successfull
 * @param {Function} config.postAuthenticate=noop -  called after the client is authenticated
 * @param {Number} [config.timeout=1000] - amount of millisenconds to wait for a client to
 * authenticate before disconnecting it. A value of 'none' means no connection timeout.
 */
module.exports = function socketIOAuth(io, config) {
    var cleanedConfig = cleanConfig(config);
    _.each(io.nsps, forbidConnections);
    _.each(io.nsps, function(nsp) { setupConnectionHandlers(nsp, io, cleanedConfig); });
};

function setupConnectionHandlers(nsp, io, config) {
    nsp.on('connection', function(socket) {
        if (socket.auth) {
            return;
        }
        socket.auth = false;
        socket.on('authentication', function(data) { authenticateSocket(io, socket, data, config) });
        setupTimeout(config.timeout, socket);
    });
}

function setupTimeout(timeout, socket) {
    if (timeout === 'none') {
        return;
    }
    setTimeout(function() {
        if (!socket.auth) {
            debug('timeout: disconnecting socket: nsp: %s, id: %s', socket.nsp.name, socket.id);
            socket.disconnect('unauthorized');
        }
    }, timeout);
}

function authenticateSocket(io, socket, data, config) {
    config.authenticate(socket, data, function(err, success) {
        if (success) {
            debug('authentication success: nsp: %s, id: %s', socket.nsp.name, socket.id);
            var postAuthenticate = function(socket) { config.postAuthenticate(socket, data); }
            _.each(io.nsps, function(nsp) { authConnections(nsp, socket.id, postAuthenticate); });
        }
        else {
            debug('authentication failure: nsp: %s, id: %s', socket.nsp.name, socket.id);
            var message = err ? err.message : 'Authentication failure';
            _.each(io.nsps, function(nsp) { disconnectConnections(nsp, socket.id, message); });
        }
    });
}

function cleanConfig(config) {
    var config = config || {};
    return {
        timeout: config.timeout || 1000,
        authenticate: config.authenticate,
        postAuthenticate: config.postAuthenticate || _.noop,
    };
}

/**
 * Set a listener so connections from unauthenticated sockets are not
 * considered when emitting to the namespace. The connections will be
 * restored after authentication succeeds.
 */
function forbidConnections(nsp) {
    nsp.on('connect', function(socket) {
        if (!socket.auth) {
            debug('removing socket from %s', nsp.name);
            delete nsp.connected[socket.id];
        }
    });
}

/**
 * If the socket attempted a connection before authentication, restore it.
 */
function authConnections(nsp, socketId, postAuthenticate) {
    var socket = _.findWhere(nsp.sockets, (socket) => {
        return rootSocketId(socket.id) === rootSocketId(socketId);
    });

    if (socket) {
        // set it to authorised and apply run post-authentication logic
        socket.auth = true;
        postAuthenticate(socket);
        socket.emit('authenticated', true);
  
        // re-add to the connected list
        nsp.connected[socketId] = socket;
    }
}

/**
 * Disconnect all sockets in this namespace with the socket id.
 */
function disconnectConnections(nsp, socketId, message) {
    var socket = _.findWhere(nsp.sockets, (socket) => {
        return rootSocketId(socket.id) === rootSocketId(socketId);
    });
    
    if (socket) {
        debug('sending unauthorized message + disconnect: nsp: %s, id: %s, message: %s', socket.nsp.name, socket.id, message);
        socket.emit('unauthorized', {message: message}, function() {
            socket.disconnect();
        });
    }
}

/**
 * Get the socket id without any namespace qualifier.
 */
function rootSocketId(socketId) {
    return socketId.substring(socketId.indexOf("#") + 1);
}