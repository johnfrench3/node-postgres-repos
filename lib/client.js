var sys = require('sys');
var net = require('net');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;

var utils = require(__dirname + '/utils');
var BufferList = require(__dirname + '/buffer-list');
var Connection = require(__dirname + '/connection');

var Client = function(config) {
  EventEmitter.call(this);
  config = config || {};
  this.user = config.user;
  this.database = config.database;
  this.port = config.port || 5432;
  this.host = config.host;
  this.queryQueue = [];

  this.connection = config.connection || new Connection({stream: config.stream || new net.Stream()});
  this.queryQueue = [];
  this.password = config.password || '';
  this.lastBuffer = false;
  this.lastOffset = 0;
  this.buffer = null;
  this.offset = null;
  this.encoding = 'utf8';
};

sys.inherits(Client, EventEmitter);

var p = Client.prototype;

p.connect = function() {
  var self = this;
  var con = this.connection;
  con.connect(this.port, this.host);

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

  con.on('readyForQuery', function() {
    self.readyForQuery = true;

    self.pulseQueryQueue();
  });

  con.on('error', function(error) {
    self.emit('error', error);
  });
};

p.pulseQueryQueue = function() {
  if(this.readyForQuery===true && this.queryQueue.length > 0) {
    this.readyForQuery = false;
    var query = this.queryQueue.shift();
    query.submit(this.connection);
  }
};

p.query = function(config) {
  var query = new Query({text: config});
  this.queryQueue.push(query);
  this.pulseQueryQueue();
  return query;
};

p.end = function() {
  this.connection.end();
};

Client.md5 = function(string) {
  return crypto.createHash('md5').update(string).digest('hex');
};

var Query = function(config) {
  this.text = config.text;
  //for code clarity purposes we'll declare this here though it's not
  //set or used until a rowDescription message comes in
  this.rowDescription = null;
  EventEmitter.call(this);
};
sys.inherits(Query, EventEmitter);p
var p = Query.prototype;

p.submit = function(connection) {
  var self = this;
  connection.query(this.text);
  var handleRowDescription = function(msg) {
    self.onRowDescription(msg);
  };
  var handleDatarow = function(msg) {
    self.onDataRow(msg);
  };
  connection.on('rowDescription', handleRowDescription);
  connection.on('dataRow', handleDatarow);
  connection.once('readyForQuery', function() {
    //remove all listeners
    connection.removeListener('rowDescription', handleRowDescription);
    connection.removeListener('dataRow', handleDatarow);
    self.emit('end');
  });
};

p.onRowDescription = function(msg) {
  var typeIds = msg.fields.map(function(field) {
    return field.dataTypeID;
  });
  var noParse = function(val) {
    return val;
  };

  this.converters = typeIds.map(function(typeId) {
    return Client.dataTypeParser[typeId] || noParse;
  });
};

//handles the raw 'dataRow' event from the connection does type coercion
p.onDataRow = function(msg) {
  var fields = msg.fields;
  var converters = this.converters || [];
  var len = msg.fields.length;
  for(var i = 0; i < len; i++) {
    fields[i] = this.converters[i] (fields[i]);
  }
  msg.fields = fields;
  this.emit('row', msg);
};



// var intParser = {
//   fromDbValue: parseInt
// };

// var floatParser = {
//   fromDbValue: parseFloat
// };

// var timeParser = {
//   fromDbValue: function(isoTime) {
//     var when = new Date();
//     var split = isoTime.split(':');
//     when.setHours(split[0]);
//     when.setMinutes(split[1]);
//     when.setSeconds(split[2].split('-') [0]);
//     return when;
//   }
// };

// var dateParser = {
//   fromDbValue: function(isoDate) {
//     return Date.parse(isoDate);
//   }
// };

Client.dataTypeParser = {
  20: parseInt,
  21: parseInt,
  23: parseInt,
  26: parseInt
  //   1700: floatParser,
  //   700: floatParser,
  //   701: floatParser,
  //   1083: timeParser,
  //   1266: timeParser,
  //   1114: dateParser,
  //   1184: dateParser
};

// p.processRowDescription = function(description) {
//   this.fields = description.fields;
// };

// p.processDataRow = function(dataRow) {
//   var row = dataRow.fields;
//   var fields = this.fields || [];
//   var field, dataType;
//   for(var i = 0, len = row.length; i < len; i++) {
//     field = fields[i] || 0
//     var dataType = Client.dataTypes[field.dataTypeID];
//     if(dataType) {
//       row[i] = dataType.fromDbValue(row[i]);
//     }
//   }
//   this.emit('row',row);
// };

//end parsing methods
module.exports = Client;
