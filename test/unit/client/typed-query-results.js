var helper = require(__dirname + '/test-helper');
//http://www.postgresql.org/docs/8.4/static/datatype.html
test('typed results', function() {
  var client = helper.client();
  var con = client.connection;
  con.emit('readyForQuery');
  var query = client.query("the bums lost");


  assert.raises(query, 'row', function(row) {
    var testParses = function(name, index, expected) {
      test('parses ' + name, function() {
        assert.strictEqual(row.fields[index], expected);
      });
    };
    testParses('string', 0, 'bang');
    testParses('integer / int4', 1, 1394);
    testParses('smallInt / int2', 2, 4);
    testParses('bigint / int8', 3, 1234567890);
    testParses('oid', 4, 1234);
  });

  con.emit('rowDescription', {
    fieldCount: 2,
    fields: [{
      name: 'string/varchar', //note: field name has NO influence on type parsing...
      dataTypeID: 1043
    },{
      name: 'integer/int4',
      dataTypeID: 23 //int4, integer
    },{
      name: 'smallint/int2',
      dataTypeID: 21
    },{
      name: 'bigint/int8',
      dataTypeID: 20
    },{
      name: 'oid',
      dataTypeID: 26
    }]
  });

  assert.ok(con.emit('dataRow', {fields:[
    'bang', //varchar
    '1394',  //integer
    '4', //smallint
    '1234567890', //bigint (yes, i know, this isn't 8 bytes)
    '1234' //oid
  ]}));

});
