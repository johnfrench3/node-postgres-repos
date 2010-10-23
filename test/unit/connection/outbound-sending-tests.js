require(__dirname + "/test-helper");
var stream = new MemoryStream();
var con = new Connection({
  stream: stream
});

assert.recieved = function(stream, buffer) {
  assert.length(stream.packets, 1);
  var packet = stream.packets.pop();
  assert.equalBuffers(packet, buffer);
};

test("sends startup message", function() {
  con.startupMessage({
    user: 'brian',
    database: 'bang'
  });
  assert.recieved(stream, new BufferList()
                  .addInt16(3)
                  .addInt16(0)
                  .addCString('user')
                  .addCString('brian')
                  .addCString('database')
                  .addCString('bang')
                  .addCString('').join(true))
});

test('sends query message', function() {
  var txt = 'select * from boom';
  con.query(txt);
  assert.recieved(stream, new BufferList().addCString(txt).join(true,'Q'));
});

test('sends parse message', function() {
  con.parse({text: '!'});
  var expected = new BufferList()
    .addCString("")
    .addCString("!")
    .addInt16(0).join(true, 'P');
  assert.recieved(stream, expected);
});

test('sends parse message with named query', function() {
  con.parse({
    name: 'boom',
    text: 'select * from boom',
    types: []
  });
  var expected = new BufferList()
    .addCString("boom")
    .addCString("select * from boom")
    .addInt16(0).join(true,'P');
  assert.recieved(stream, expected);
});

test('sends bind to unamed statement with no values', function() {
  con.bind();

  var expectedBuffer = new BufferList()
    .addCString("")
    .addCString("")
    .addInt16(0)
    .addInt16(0)
    .addInt16(0).join(true,"B");
  assert.recieved(stream, expectedBuffer);
});


test("sends execute message for unamed portal with no row limit", function() {
  con.execute();
  var expectedBuffer = new BufferList()
    .addCString('')
    .addInt32(0)
    .join(true,'E');
  assert.recieved(stream, expectedBuffer);
});


test('sends flush command', function() {
  con.flush();
  var expected = new BufferList().join(true, 'H');
  assert.recieved(stream, expected);
});

test('sends sync command', function() {
  con.sync();
  var expected = new BufferList().join(true,'S');
  assert.recieved(stream, expected);
});
