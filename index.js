var assert = require('assert')
var Readable = require('stream').Readable
var Result = require('pg')

var path = require('path')

var pgdir = false
try {
  pgdir = path.dirname(require.resolve('pg'))
} catch (e) {
  pgdir = path.dirname(require.resolve('pg.js'))
}
if(!pgdir) {
  throw new Error("Please install either `pg` or `pg.js` to use this module")
}
var Result = require(path.join(pgdir, 'result'))
var utils = require(path.join(pgdir, 'utils'))

var QueryStream = module.exports = function(text, values, options) {
  options = options || {
    highWaterMark: 100,
    batchSize: 100
  }
  Readable.call(this, {
    objectMode: true,
    highWaterMark: 100
  })
  this.text = text
  assert(this.text, 'text cannot be falsy')
  this.values = (values || []).map(utils.prepareValue)
  this.name = ''
  this._result = new Result()
  this.batchSize = 100
  this._idle = true
}

require('util').inherits(QueryStream, Readable)

QueryStream.prototype._read = function(n) {
  this._getRows(n)
}

QueryStream.prototype._getRows = function(count) {
  var con = this.connection
  if(!this._idle || !this.connection) return;
  this._idle = false
  con.execute({
    portal: '',
    rows: count
  }, true)

  con.flush()
}

QueryStream.prototype.submit = function(con) {
  //save reference to connection
  this.connection = con

  var name = this.name

  con.parse({
    text: this.text,
    name: name,
    types: []
  }, true)

  con.bind({
    portal: '',
    statement: name,
    values: this.values,
    binary: false
  }, true)

  con.describe({
    type: 'P',
    name: name
  }, true)

  this._getRows(this.batchSize)

}

QueryStream.prototype.handleRowDescription = function(msg) {
  this._result.addFields(msg.fields)
}

QueryStream.prototype.handleDataRow = function(msg) {
  var row = this._result.parseRow(msg.fields)
  this._more = this.push(row)
}

QueryStream.prototype.handlePortalSuspended = function(msg) {
  this._idle = true
  if(this._more) {
    this._getRows(this.batchSize)
  }
}

QueryStream.prototype.handleCommandComplete = function(msg) {
  this.connection.sync()
}

QueryStream.prototype.handleReadyForQuery = function() {
  this.push(null)
}
