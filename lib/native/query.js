var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../utils');

var NativeQuery = module.exports = function(native) {
  EventEmitter.call(this);
  this.native = native;
  this.text = null;
  this.values = null;
  this.name = null;
  this.callback = null;
  this.state = 'new';

  //if the 'row' event is listened for
  //then emit them as they come in
  //without setting singleRowMode to true
  //this has almost no meaning because libpq
  //reads all rows into memory befor returning any
  this._emitRowEvents = false;
  this.on('newListener', function(event) {
    if(event === 'row') this._emitRowEvents = true;
  }.bind(this));
};

util.inherits(NativeQuery, EventEmitter);

//given an array of values, turn all `undefined` into `null`
var clean = function(values) {
  for(var i = 0; i < values.length; i++) {
    if(typeof values[i] == 'undefined') {
      values[i] = null;
    }
  }
};

var NativeResult = function(pq) {
  this.command = null;
  this.rowCount = 0;
  this.rows = null;
  this.fields = null;
};

NativeResult.prototype.addCommandComplete = function(pq) {
  this.command = pq.cmdStatus().split(' ')[0];
  this.rowCount = pq.cmdTuples();
  var nfields = pq.nfields();
  if(nfields < 1) return;

  this.fields = [];
  for(var i = 0; i < nfields; i++) {
    this.fields.push({
      name: pq.fname(i),
      dataTypeID: pq.ftype(i)
    });
  }
};

NativeQuery.prototype.submit = function() {
  this.state = 'running';
  var self = this;

  var after = function(err, rows) {
    setImmediate(function() {
      self.emit('_done');
    });

    //handle possible query error
    if(err) {
      self.state = 'error';
      if(self.callback) return self.callback(err);
      return self.emit('error', err);
    }

    var result = new NativeResult();
    result.addCommandComplete(self.native.pq);
    result.rows = rows;

    //emit row events for each row in the result
    if(self._emitRowEvents) {
      rows.forEach(function(row) {
        self.emit('row', row, result);
      });
    }


    //handle successful result
    self.state = 'end';
    self.emit('end', result);
    if(self.callback) {
      self.callback(null, result);
    }
  }

  if(this.values) {
    var values = this.values.map(utils.prepareValue);
    this.native.query(this.text, values, after);
  } else {
    this.native.query(this.text, after);
  }
};
