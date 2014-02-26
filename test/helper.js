var pg = require('pg')
module.exports = function(cb) {
  describe('pg-query-stream', function() {
    var client = new pg.Client()

    before(function(done) {
      client.connect(done)
    })

    cb(client)

    after(function(done) {
      client.end()
      client.on('end', done)
    })
  })
}
