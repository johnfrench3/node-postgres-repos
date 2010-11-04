var EventEmitter = require('events').EventEmitter;
var sys = require('sys');var sys = require('sys');
var Row = require(__dirname + '/row');

var Query = function(config) {
  this.text = config.text;
  this.values = config.values;
  this.rows = config.rows;
  this.types = config.types;
  this.name = config.name;
  //for code clarity purposes we'll declare this here though it's not
  //set or used until a rowDescription message comes in
  this.rowDescription = null;
  EventEmitter.call(this);
};

sys.inherits(Query, EventEmitter);
var p = Query.prototype;

p.requiresPreparation = function() {
  return (this.values || 0).length > 0 || this.name || this.rows;
};


var noParse = function(val) {
  return val;
};

p.submit = function(connection) {
  var self = this;
  if(this.requiresPreparation()) {
    this.prepare(connection);
  } else {
    connection.query(this.text);
  }
  var converters = [];
  var names = [];
  var handleRowDescription = function(msg) {
    for(var i = 0; i < msg.fields.length; i++) {
      converters[i] = dataTypeParsers[msg.fields[i].dataTypeID] || noParse;
      names[i] = msg.fields[i].name;
    };
  };
  var handleDatarow = function(msg) {
    var result = new Row();
    for(var i = 0; i < msg.fields.length; i++) {
      var rawValue = msg.fields[i];
      result[names[i]] = rawValue === null ? null : converters[i](rawValue);
    }
    self.emit('row', result);
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

p.hasBeenParsed = function(connection) {
  return this.name && connection.parsedStatements[this.name];
};

p.prepare = function(connection) {
  var self = this;

  if(!this.hasBeenParsed(connection)) {
    connection.parsedStatements[this.name] = true;
    connection.parse({
      text: self.text,
      name: self.name,
      types: self.types
    });
  }

  //TODO is there some btter way to prepare values for the database?
  if(self.values) {
    self.values = self.values.map(function(val) {
      return (val instanceof Date) ? JSON.stringify(val) : val;
    });
  }

  //http://developer.postgresql.org/pgdocs/postgres/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
  connection.bind({
    portal: self.name,
    statement: self.name,
    values: self.values
  });

  connection.describe({
    type: 'P',
    name: self.name || ""
  });

  //TODO test for & support multpile row requests
  connection.execute({
    portal: self.name,
    rows: self.rows
  });

  connection.flush();

  //TODO support EmptyQueryResponse, ErrorResponse, and PortalSuspended
  var onCommandComplete =  function() {
    connection.sync();
  };

  connection.once('commandComplete', onCommandComplete);
};

var dateParser = function(isoDate) {
  //TODO find some regexp help
  //this method works but it's ooglay
  //if you wanna contribute...... ;)
  var split = isoDate.split(' ');
  var dateMatcher = /(\d{4})-(\d{2})-(\d{2})/;

  var date = split[0];
  var time = split[1];
  var match = dateMatcher.exec(date);
  var splitDate = date.split('-');
  var year = match[1];
  var month = parseInt(match[2])-1;
  var day = match[3];

  var splitTime = time.split(':');
  var hour = parseInt(splitTime[0]);
  var min = splitTime[1];
  var end = splitTime[2];
  var seconds = /(\d{2})/.exec(end);
  seconds = (seconds ? seconds[1] : 0);
  var mili = /\.(\d{1,})/.exec(end);
  mili = mili ? mili[1].slice(0,3) : 0;
  var tZone = /([Z|+\-])(\d{2})?(\d{2})?/.exec(end);
  //minutes to adjust for timezone
  var tzAdjust = 0;
  if(tZone) {
    var type = tZone[1];
    switch(type) {
    case 'Z': break;
    case '-':
      tzAdjust = -(((parseInt(tZone[2])*60)+(parseInt(tZone[3]||0))));
      break;
    case '+':
      tzAdjust = (((parseInt(tZone[2])*60)+(parseInt(tZone[3]||0))));
      break;
    default:
      throw new Error("Unidentifed tZone part " + type);
    }
  }

  var utcOffset = Date.UTC(year, month, day, hour, min, seconds, mili);

  var date = new Date(utcOffset - (tzAdjust * 60* 1000));
  return date;
};

var dataTypeParsers = {
  20: parseInt,
  21: parseInt,
  23: parseInt,
  26: parseInt,
  1700: parseFloat,
  700: parseFloat,
  701: parseFloat,
  16: function(dbVal) { //boolean
    return dbVal === 't';
  },
  1114: dateParser,
  1184: dateParser
};


module.exports = Query;
