var genericPool = require('generic-pool')
var util = require('util')
var EventEmitter = require('events').EventEmitter
var debug = require('debug')

var Pool = module.exports = function(options) {
  EventEmitter.call(this)
  this.options = options || {}
  this.log = this.options.log || debug('pg:pool')
  this.Client = this.options.Client || require('pg').Client
  this.Promise = this.options.Promise || Promise

  this.options.max = this.options.max || this.options.poolSize || 10
  this.options.create = this.options.create || this._create.bind(this)
  this.options.destroy = this.options.destroy || this._destroy.bind(this)
  this.pool = new genericPool.Pool(this.options)
}

util.inherits(Pool, EventEmitter)

Pool.prototype._destroy = function(client) {
  if (client._destroying) return
  client._destroying = true
  client.end()
}

Pool.prototype._create = function(cb) {
  this.log('connecting new client')
  var client = new this.Client(this.options)

  client.on('error', function(e) {
    this.log('connected client error:', e)
    this.pool.destroy(client)
    e.client = client
    this.emit('error', e)
  }.bind(this))

  client.connect(function(err) {
    this.log('client connected')
    if (err) {
      this.log('client connection error:', e)
      cb(err)
    }

    client.queryAsync = function(text, values) {
      return new this.Promise((resolve, reject) => {
        client.query(text, values, function(err, res) {
          err ? reject(err) : resolve(res)
        })
      })
    }.bind(this)

    cb(err, err ? null : client)
  }.bind(this))
}

Pool.prototype.connect = function(cb) {
  return new this.Promise(function(resolve, reject) {
    this.log('acquire client begin')
    this.pool.acquire(function(err, client) {
      if (err) {
        this.log('acquire client. error:', err)
        if (cb) {
          cb(err, null, function() { })
        }
        return reject(err)
      }

      this.log('acquire client')

      client.release = function(err) {
        if (err) {
          this.log('release client. error:', err)
          this.pool.destroy(client)
        }
        this.log('release client')
        delete client.release
        this.pool.release(client)
      }.bind(this)

      if (cb) {
        cb(null, client, client.release)
      }

      return resolve(client)
    }.bind(this))
  }.bind(this))
}

Pool.prototype.take = Pool.prototype.connect

Pool.prototype.query = function(text, values) {
  return this.take().then(function(client) {
    return client.queryAsync(text, values)
      .then(function(res) {
        client.release()
        return res
      }).catch(function(error) {
        client.release(error)
        throw error
      })
  })
}

Pool.prototype.end = function(cb) {
  this.log('draining pool')
  return new this.Promise(function(resolve, reject) {
    this.pool.drain(function() {
      this.log('pool drained, calling destroy all now')
      this.pool.destroyAllNow(function() {
        if(cb) {
          cb()
        }
        resolve()
      })
    }.bind(this))
  }.bind(this))
}
