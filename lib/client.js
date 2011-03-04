var sys = require('sys');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;

var Query = require(__dirname + '/query');
var utils = require(__dirname + '/utils');
var defaults = require(__dirname + '/defaults');
var Connection = require(__dirname + '/connection');

var Client = function(config) {
  EventEmitter.call(this);
  if(typeof config === 'string') {
    config = utils.normalizeConnectionInfo(config)
  }
  config = config || {};
  this.user = config.user || defaults.user;
  this.database = config.database || defaults.database;
  this.port = config.port || defaults.port;
  this.host = config.host || defaults.host;
  this.queryQueue = [];
  this.connection = config.connection || new Connection({stream: config.stream});
  this.queryQueue = [];
  this.password = config.password || defaults.password;
  this.encoding = 'utf8';
  var self = this;
  this.connection.on('notify', function(msg) {
    self.emit('notify', msg);
  })
};

sys.inherits(Client, EventEmitter);

var p = Client.prototype;

p.connect = function() {
  var self = this;
  var con = this.connection;
  if(this.host && this.host.indexOf('/') === 0) {
    con.connect(this.host + '/.s.PGSQL.' + this.port);
  } else {
    con.connect(this.port, this.host);
  }


  //once connection is established send startup message
  con.on('connect', function() {
    con.startup({
      user: self.user,
      database: self.database
    });
  });

  //password request handling
  con.on('authenticationCleartextPassword', function() {
    con.password(self.password);
  });

  //password request handling
  con.on('authenticationMD5Password', function(msg) {
    var inner = Client.md5(self.password + self.user);
    var outer = Client.md5(inner + msg.salt.toString('binary'));
    var md5password = "md5" + outer;
    con.password(md5password);
  });

  //hook up query handling events to connection
  //after the connection initially becomes ready for queries
  con.once('readyForQuery', function() {
    //delegate row descript to active query
    con.on('rowDescription', function(msg) {
      self.activeQuery.handleRowDescription(msg);
    });
    //delegate datarow to active query
    con.on('dataRow', function(msg) {
      self.activeQuery.handleDataRow(msg);
    });
    //TODO should query gain access to connection?
    con.on('portalSuspended', function(msg) {
      self.activeQuery.getRows(con);
    });

    con.on('commandComplete', function(msg) {
      //delegate command complete to query
      self.activeQuery.handleCommandComplete(msg);
      //need to sync after each command complete of a prepared statement
      if(self.activeQuery.isPreparedStatement) {
        con.sync();
      }
    });

  });

  con.on('readyForQuery', function() {
    if(self.activeQuery) {
      self.activeQuery.handleReadyForQuery();
    }
    this.activeQuery = null;
    self.readyForQuery = true;
    self._pulseQueryQueue();
  });

  con.on('error', function(error) {
    if(!self.activeQuery) {
      self.emit('error', error);
    } else {
      //need to sync after error during a prepared statement
      if(self.activeQuery.isPreparedStatement) {
        con.sync();
      }
      self.activeQuery.handleError(error);
      self.activeQuery = null;
    }
  });
};

p._pulseQueryQueue = function() {
  if(this.readyForQuery===true) {
    this.activeQuery = this.queryQueue.shift();
    if(this.activeQuery) {
      this.readyForQuery = false;
      this.hasExecuted = true;
      this.activeQuery.submit(this.connection);
    } else if(this.hasExecuted) {
      this.activeQuery = null;
      this.emit('drain')
    }
  }
};

p.query = function(config, values, callback) {
  //can take in strings or config objects
  config = (config.text || config.name) ? config : { text: config };

  if(values) {
    if(typeof values === 'function') {
      callback = values;
    } else {
      config.values = values;
    }
  }

  config.callback = callback;

  var query = new Query(config);
  this.queryQueue.push(query);
  this._pulseQueryQueue();
  return query;
};

p.end = function() {
  this.connection.end();
};

Client.md5 = function(string) {
  return crypto.createHash('md5').update(string).digest('hex');
};

module.exports = Client;
