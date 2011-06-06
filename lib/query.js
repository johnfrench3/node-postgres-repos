var EventEmitter = require('events').EventEmitter;
var sys = require('sys');var sys = require('sys');
var Result = require(__dirname + "/result");
var TextParser = require(__dirname + "/textParser");
var BinaryParser = require(__dirname + "/binaryParser");

var Query = function(config) {
  this.text = config.text;
  this.values = config.values;
  this.rows = config.rows;
  this.types = config.types;
  this.name = config.name;
  this.binary = config.binary;
  //for code clarity purposes we'll declare this here though it's not
  //set or used until a rowDescription message comes in
  this.rowDescription = null;
  this.callback = config.callback;
  this._fieldNames = [];
  this._fieldConverters = [];
  this._result = new Result();
  this.isPreparedStatement = false;
  EventEmitter.call(this);
};

sys.inherits(Query, EventEmitter);
var p = Query.prototype;

p.requiresPreparation = function() {
  return (this.values || 0).length > 0 || this.name || this.rows || this.binary;
};


var noParse = function(val) {
  return val;
};

//associates row metadata from the supplied
//message with this query object
//metadata used when parsing row results
p.handleRowDescription = function(msg) {
  this._fieldNames = [];
  this._fieldConverters = [];

  var parsers = {
    text: new TextParser(),
    binary: new BinaryParser()
  };

  var len = msg.fields.length;
  for(var i = 0; i < len; i++) {
    var field = msg.fields[i];
    var dataTypeId = field.dataTypeID;
    var format = field.format;
    this._fieldNames[i] = field.name;
    switch(dataTypeId) {
    case 20:
      this._fieldConverters[i] = parsers[format].parseInt64;
      break;
    case 21:
      this._fieldConverters[i] = parsers[format].parseInt16;
      break;
    case 23:
      this._fieldConverters[i] = parsers[format].parseInt32;
      break;
    case 25:
      this._fieldConverters[i] = parsers[format].parseText;
      break;
    case 26:
      this._fieldConverters[i] = parsers[format].parseInt64;
      break;
    case 700:
      this._fieldConverters[i] = parsers[format].parseFloat32;
      break;
    case 701:
      this._fieldConverters[i] = parsers[format].parseFloat64;
      break;
    case 1700:
      this._fieldConverters[i] = parsers[format].parseNumeric;
      break;
    case 16:
      this._fieldConverters[i] = parsers[format].parseBool;
      break;
    case 1114:
    case 1184:
      this._fieldConverters[i] = parsers[format].parseDate;
      break;
    case 1008:
    case 1009:
      this._fieldConverters[i] = parsers[format].parseStringArray;
      break;
    case 1007:
    case 1016:
      this._fieldConverters[i] = parsers[format].parseIntArray;
      break;
    default:
      this._fieldConverters[i] = dataTypeParsers[dataTypeId] || noParse;
      break;
    }
  };
};

p.handleDataRow = function(msg) {
  var self = this;
  var row = {};
  for(var i = 0; i < msg.fields.length; i++) {
    var rawValue = msg.fields[i];
    if(rawValue === null) {
      //leave null values alone
      row[self._fieldNames[i]] = null;
    } else {
      //convert value to javascript
      row[self._fieldNames[i]] = self._fieldConverters[i](rawValue);
    }
  }
  self.emit('row', row);

  //if there is a callback collect rows
  if(self.callback) {
    self._result.addRow(row);
  }
};

p.handleCommandComplete = function(msg) {
  this._result.addCommandComplete(msg);
};

p.handleReadyForQuery = function() {
  if(this.callback) {
    this.callback(null, this._result);
  }
  this.emit('end', this._result);
};

p.handleError = function(err) {
  //if callback supplied do not emit error event as uncaught error
  //events will bubble up to node process
  if(this.callback) {
    this.callback(err)
  } else {
    this.emit('error', err);
  }
  this.emit('end');
};

p.submit = function(connection) {
  var self = this;
  if(this.requiresPreparation()) {
    this.prepare(connection);
  } else {
    connection.query(this.text);
  }
};

p.hasBeenParsed = function(connection) {
  return this.name && connection.parsedStatements[this.name];
};

p.getRows = function(connection) {
  connection.execute({
    portal: this.name,
    rows: this.rows
  });
  connection.flush();
};

p.prepare = function(connection) {
  var self = this;
  //prepared statements need sync to be called after each command
  //complete or when an error is encountered
  this.isPreparedStatement = true;
  //TODO refactor this poor encapsulation
  if(!this.hasBeenParsed(connection)) {
    connection.parse({
      text: self.text,
      name: self.name,
      types: self.types
    });
    connection.parsedStatements[this.name] = true;
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
    values: self.values,
    binary: self.binary
  });

  connection.describe({
    type: 'P',
    name: self.name || ""
  });

  this.getRows(connection);
};

var dataTypeParsers = {
};

module.exports = Query;
