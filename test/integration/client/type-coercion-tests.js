var helper = require(__dirname + '/test-helper');

var client = helper.client();

client.query("create temp table test_type(col varchar(10))");

var testForTypeCoercion = function(type){
  test("Coerces " + type.name, function() {
    client.query("drop table test_type")
    client.query("create temp table test_type(col " + type.name + ")");
    type.values.forEach(function(val) {

      client.query({
        name: 'insert type test ' + type.name,
        text: 'insert into test_type(col) VALUES($1)',
        values: [val]
      });

      var query = client.query({
        name: 'get type ' + type.name ,
        text: 'select col from test_type'
      });

      test('coerces ' + val + ' as ' + type.name, function() {
        assert.emits(query, 'row', function(row) {
          assert.strictEqual(row.fields[0], val);
        });
      });

      client.query({
        name: 'delete values',
        text: 'delete from test_type'
      });

    });
  });
};

//TODO test for nulls
var types = [{
  name: 'integer',
  values: [1, -1, null]
},{
  name: 'smallint',
  values: [-1, 0, 1, null]
},{
  name: 'bigint',
  values: [-10000, 0, 10000, null]
},{
  name: 'varchar(5)',
  values: ['yo', '', 'zomg!', null]
},{
  name: 'oid',
  values: [0, 204410, null]
},{
  name: 'bool',
  values: [true, false, null]
},{
  //TODO get some actual huge numbers here
  name: 'numeric',
  values: [-12.34, 0, 12.34, null]
},{
  name: 'real',
  values: [101.1, 0, -101.3, null]
},{
  name: 'double precision',
  values: [-1.2, 0, 1.2, null]
}];

types.forEach(testForTypeCoercion);

client.on('drain', client.end.bind(client));
