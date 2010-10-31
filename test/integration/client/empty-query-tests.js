var helper = require(__dirname+'/test-helper');
var client = helper.client();

test("empty query message handling", function() {
  client.query("");
  assert.emits(client.connection, 'emptyQuery');
  client.on('drain', client.end.bind(client));
});
