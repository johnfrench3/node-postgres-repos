sys = require('sys');
assert = require('assert');
Client = require(__dirname+'/../../lib/client');
EventEmitter = require('events').EventEmitter;
BufferList = require(__dirname+'/buffer-list');
buffers = require(__dirname+'/test-buffers');


assert.same = function(actual, expected) {
  for(var key in expected) {
    assert.equal(actual[key], expected[key]);
  }
};

assert.equalBuffers = function(actual, expected) {
  if(actual.length != expected.length) {
    console.log(actual);
    console.log(expected);
    assert.equal(actual.length, expected.length);
  }
  for(var i = 0; i < actual.length; i++) {
    if(actual[i] != expected[i]) {
      console.log(actual);
      console.log(expected);
    }
    assert.equal(actual[i],expected[i]);
  }
};

assert.empty = function(actual) {
  assert.length(actual, 0);
};

assert.length = function(actual, expectedLength) {
  assert.equal(actual.length, expectedLength);
};

test = function(name, action) {
  try{
    test.testCount ++;
    var result = action();
    if(result === false) {
      test.ignored.push(name);
      process.stdout.write('?');
    }else{
      process.stdout.write('.');
    }
  }catch(e) {
    console.log('E');
    test.errors.push(e);
  }
};
test.testCount = 0;
test.ignored = [];
test.errors = [];

var start = new Date();
process.on('exit', function() {
  console.log('');
  console.log('Ran ' + test.testCount + ' tests in ' + ((new Date() - start)/1000) + ' seconds');
  test.ignored.forEach(function(name) {
    console.log("Ignored: " + name);
  });
});

MemoryStream = function() {
  EventEmitter.call(this);
  this.packets = [];
};

sys.inherits(MemoryStream, EventEmitter);

var p = MemoryStream.prototype;

p.write = function(packet) {
  this.packets.push(packet);
};

createClient = function() {
  var stream = new MemoryStream();
  stream.readyState = "open";
  var client = new Client({
    stream: stream
  });
  client.connect();
  return client;
};
