var helper = require(__dirname + '/../test-helper');
var pg = require(__dirname + '/../../../lib');

var connected = false
var called = false
pg.connect(helper.args, function(err, client) {
  connected = true
  test('error is null', function() {
    assert.equal(err, null)
  })

  test('query execution', function() {
    client.query('CREATE TEMP TABLE band(name varchar(100))')
    client.query("INSERT INTO band (name) VALUES ('dead black hearts')")
    client.query("SELECT * FROM band WHERE name = 'dead black hearts'", function(err, result) {
      called = true;
      assert.equal(result.rows.pop().name, 'dead black hearts')
    })
  })

})

process.on('exit', function() {
  assert.ok(connected, 'never connected')
  assert.ok(called, 'query result callback was never called')
})





test('raises error if cannot connect', function() {
  pg.connect({database:'asdlfkajsdf there is no way this is a real database, right?!'}, function(err, client) {
    assert.ok(err, 'error was null')
  })
})



