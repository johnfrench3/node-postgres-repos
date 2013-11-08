var assert = require('assert')
var pgCursor = require('../')
var gonna = require('gonna')

var text = 'SELECT generate_series as num FROM generate_series(0, 5)'
var values = []

it('fetch 6 when asking for 10', function(done) {
  var cursor = pgCursor(text)
  cursor.read(10, function(err, res) {
    assert.ifError(err)
    assert.equal(res.length, 6)
    done()
  })
})

it('end before reading to end', function(done) {
  var cursor = pgCursor(text)
  cursor.read(3, function(err, res) {
    assert.equal(res.length, 3)
    cursor.end(done)
  })
})

it('callback with error', function(done) {
  var cursor = pgCursor('select asdfasdf')
  cursor.read(1, function(err) {
    assert(err)
    done()
  })
})


it('read a partial chunk of data', function(done) {
  var cursor = pgCursor(text)
  cursor.read(2, function(err, res) {
    assert.equal(res.length, 2)
    cursor.read(3, function(err, res) {
      assert.equal(res.length, 3)
      cursor.read(1, function(err, res) {
        assert.equal(res.length, 1)
        cursor.read(1, function(err, res) {
          assert.ifError(err)
          assert.strictEqual(res.length, 0)
          done()
        })
      })
    })
  })
})

it('read return length 0 past the end', function(done) {
  var cursor = pgCursor(text)
  cursor.read(2, function(err, res) {
    cursor.read(100, function(err, res) {
      assert.equal(res.length, 4)
      cursor.read(100, function(err, res) {
        assert.equal(res.length, 0)
        done()
      })
    })
  })
})

it('read huge result', function(done) {
  this.timeout(10000)
  var text = 'SELECT generate_series as num FROM generate_series(0, 1000000)'
  var values = []
  cursor = pgCursor(text, values);
  var count = 0;
  var read = function() {
    cursor.read(1000, function(err, rows) {
      if(err) return done(err);
      if(!rows.length) {
        assert.equal(count, 1000001)
        return done()
      }
      count += rows.length;
      if(count%100000 == 0) {
        //console.log(count)
      }
      setImmediate(read)
    })
  }
  read()
})
