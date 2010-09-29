var EventEmitter = require('events').EventEmitter;
var sys = require('sys');
var net = require('net');
var NUL = '\0';

var chars = Buffer('RS','utf8');
var UTF8 = {
  R: chars[0],
  S: chars[1]
};


var Client = function(config) {
  EventEmitter.call(this);
  config = config || {};
  this.user = config.user;
  this.database = config.database;
  this.port = config.port || 5432;
};
sys.inherits(Client, EventEmitter);

Client.prototype.connect = function() {
  var con = net.createConnection(this.port);
  var self = this;
  con.on('connect', function() {

    var data = ['user',self.user,'database', self.database,NUL].join(NUL);
    var dataBuffer = Buffer(data);
    var fullBuffer = Buffer(8 + dataBuffer.length);
    fullBuffer[0] = fullBuffer.length >>> 24;
    fullBuffer[1] = fullBuffer.length >>> 16;
    fullBuffer[2] = fullBuffer.length >>> 8;
    fullBuffer[3] = fullBuffer.length >>> 0;
    fullBuffer[4] = 0;
    fullBuffer[5] = 3;
    fullBuffer[6] = 0;
    fullBuffer[7] = 0;
    fullBuffer.write(data,8);
    console.log(fullBuffer);
    con.write(fullBuffer);
  });
  con.on('data', function(data) {
    console.log('data!');
    console.log(data);
  });
};

var Parser = function() {
  this.offset = 0;
};

var p = Parser.prototype;


p.parse =  function(buffer) {
  switch(buffer[this.offset]) {
  case UTF8.R:
    return this.parseR(buffer);
  case UTF8.S:
    return this.parseS(buffer);
  default:
    throw new Error("Unsupported message ID");
  }
};

p.parseR = function(buffer) {
  var type = buffer[this.offset++];
  var length = this.parseLength(buffer);
  if(length == 8) {
    return {
      name: 'AuthenticationOk',
      id: 'R',
      length: length
    }
  }
  throw new Error("Unknown AuthenticatinOk message type");
};
p.parseS = function(buffer) {
  var offset = 0;
  var type = buffer[this.offset++];
  var length = this.parseLength(buffer,this.offset);
  offset += 4;
  var start = this.offset;
  while(buffer[offset++]) { }
  var end = offset -1;
  var parameterName = buffer.toString('utf8',start, end);
  var start = offset;
  while(buffer[offset++]) { }
  var end = offset - 1;
  var parameterValue = buffer.toString('utf8', start, end);
  return {
    name: 'ParameterStatus',
    id: 'S',
    length: length,
    parameterName: parameterName,
    parameterValue: parameterValue
  }
};

p.parseLength =  function(buffer) {
  var length = ((buffer[this.offset++] << 24) +
                (buffer[this.offset++] << 16) +
                (buffer[this.offset++] << 8) +
                buffer[this.offset++]);
  return length;
};

p.parseCString = function(buffer) {
  var start = this.offset;
  while(buffer[this.offset++]) { };
  var end = this.offset - 1;
  return buffer.toString('utf8',start, end);
};


module.exports = {
  Client: Client,
  Parser: Parser
};
