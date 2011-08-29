var EventEmitter = require('events').EventEmitter;
var sys = require('sys');
var Client = require(__dirname+'/client');
var defaults =  require(__dirname + '/defaults');
var genericPool = require('generic-pool');

//cache of existing client pools
var pools = {};

//returns connect function using supplied client constructor
var makeConnectFunction = function(pg) {
  var ClientConstructor = pg.Client;
  return function(config, callback) {
    var c = config;
    var cb = callback;
    //allow for no config to be passed
    if(typeof c === 'function') {
      cb = c;
      c = defaults;
    }
    //get unique pool name if using a config object instead of config string
    var poolName = typeof(c) === 'string' ? c : c.user+c.host+c.port+c.database;
    var pool = pools[poolName];
    if(pool) return pool.acquire(cb);
    var pool = pools[poolName] = genericPool.Pool({
      name: poolName,
      create: function(callback) {
        var client = new ClientConstructor(c);
        client.connect();
        var connectError = function(err) {
          client.removeListener('connect', connectSuccess);
          callback(err, null);
        };
        var connectSuccess = function() {
          client.removeListener('error', connectError);

          //handle connected client background errors by emitting event
          //via the pg object and then removing errored client from the pool
          client.on('error', function(e) {
            pg.emit('error', e, client);
            pool.destroy(client);
          });
          callback(null, client);
        };
        client.once('connect', connectSuccess);
        client.once('error', connectError);
        client.on('drain', function() {
          pool.release(client);
        });
      },
      destroy: function(client) {
        client.end();
      },
      max: defaults.poolSize,
      idleTimeoutMillis: defaults.poolIdleTimeout
    });
    return pool.acquire(cb);
  }
}

var end = function() {
  Object.keys(pools).forEach(function(name) {
    var pool = pools[name];
    pool.drain(function() {
      pool.destroyAllNow();
    });
  })
};

var PG = function(clientConstructor) {
  EventEmitter.call(this);
  this.Client = clientConstructor;
  this.Connection = require(__dirname + '/connection');
  this.connect = makeConnectFunction(this);
  this.end = end;
  this.defaults = defaults;
};

sys.inherits(PG, EventEmitter);

module.exports = new PG(Client);

var nativeExport = null;
//lazy require native module...the c++ may not have been compiled
module.exports.__defineGetter__("native", function() {
  if(nativeExport === null) {
    var NativeClient = require(__dirname + '/native');
    nativeExport = new PG(NativeClient);
  }
  return nativeExport;
})
