var helper = require(__dirname+"/test-helper");
//before running this test make sure you run the script create-test-tables
test("simple query interface", function() {

  var client = helper.client();

  var query = client.query("select name from person");

  client.on('drain', client.end.bind(client));

  var rows = [];
  query.on('row', function(row) {
    rows.push(row['name'])
  });

  assert.emits(query, 'end', function() {
    test("returned right number of rows", function() {
      assert.length(rows, 26);
    });
    test("row ordering", function(){
      assert.equal(rows[0], "Aaron");
      assert.equal(rows[25], "Zanzabar");
    });
  });
});

test("multiple simple queries", function() {
  var client = helper.client();
  client.query("create temp table bang(id serial, name varchar(5));insert into bang(name) VALUES('boom');")
  client.query("insert into bang(name) VALUES ('yes');");
  var query = client.query("select name from bang");
  assert.emits(query, 'row', function(row) {
    assert.equal(row['name'], 'boom');
    assert.emits(query, 'row', function(row) {
      assert.equal(row['name'],'yes');
    });
  });
  client.on('drain', client.end.bind(client));
});

test("multiple select statements", function() {
  var client = helper.client();
  client.query("create temp table boom(age integer); insert into boom(age) values(1); insert into boom(age) values(2); insert into boom(age) values(3)");
  client.query("create temp table bang(name varchar(5)); insert into bang(name) values('zoom');");
  var result = client.query("select age from boom where age < 2; select name from bang");
  assert.emits(result, 'row', function(row) {
    assert.strictEqual(row['age'], 1);
    assert.emits(result, 'row', function(row) {
      assert.strictEqual(row['name'], 'zoom');
    });
  });
  client.on('drain', client.end.bind(client));
});

