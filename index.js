var spawn = require('child_process').spawn;
var inherits = require('util').inherits;
var Duplex = require('stream').Duplex;

var xtend = require('xtend');
var parse = require('shell-quote').parse;
var has = require('has');
var streamify = require('stream-array');


function appendArgv(argv, item) {
  if (item && (item = item.toString())) argv.push(item);
}


function connectSource(buffer, source, to) {
  // take all buffered chunks and the source stream and pipe into the spawned
  // process stdin
  var chunkStream = streamify(buffer);
  chunkStream.once('end', source.pipe.bind(source, to))
  chunkStream.pipe(to, {end: false});
}


function XargsStream(argv, opts) {
  Duplex.call(this);

  if (typeof argv === 'string') {
    argv = parse(argv);
  }

  argv = argv || [];
  opts = opts || {};

  var xargs = this._xargs = {
    command: argv[0] || '/bin/echo',
    argv: argv.slice(1),
    opts: opts,
    proc: null,
    externalInput: 0,
    readRequested: false,
    spawned: false,
    ended: false,
    source: null,
    target: null,
    buffer: [],
    queuedSignals: []
  };

  var spawn = this._spawn.bind(this);

  if (has(opts, 'input')) {
    var externalInput = xargs.externalInput = opts.input;

    if (externalInput) {
      setImmediate(function() {
        // External input, only spawn when all arguments have been collected.
        externalInput.on('data', appendArgv.bind(null, xargs.argv));
        externalInput.once('end', spawn);
      });
    } else {
      // When external input is specified as a falsy value, don't need to
      // collect arguments from a stream.
      setImmediate(spawn);
    }

    delete opts.input;
  } else {
    // Arguments are coming from the parent stream, so spawn after we emit the
    // finish event.(after the parent calls `end`)
    this.once('finish', spawn);
  }

  this.once('pipe', this._on_pipe.bind(this));
}
inherits(XargsStream, Duplex);


XargsStream.prototype.kill = function(signal) {
  if (this._xargs.proc) this._xargs.proc.kill(signal);
  else this._xargs.queuedSignals.push(signal);
};


XargsStream.prototype.end = function() {
  this._xargs.ended = true;
  if (this.stdin) this.stdin.end();
  Duplex.prototype.end.apply(this, arguments);
  return this;
};


XargsStream.prototype.pipe = function(target) {
  this._xargs.target = target;
  if (this.stdout) this.stdout.pipe(this._xargs.target);
  else if (this._xargs.proc) target.end();
  return target;
};


XargsStream.prototype.unpipe = function(target) {
  if (this.stdout && this._xargs.target) this.stdout.unpipe(target);
};


XargsStream.prototype._on_pipe = function(source) {
  this._xargs.source = source;
  if (this.stdin) connectSource(this._xargs.buffer, source, this.stdin);
  else if (this._xargs.readRequested) this._xargs.source.read();
};


XargsStream.prototype._spawn = function() {
  var xargs = this._xargs;

  if (xargs.spawned) {
    return;
  }

  xargs.spawned = true;
  this._read = function() {};
  this._write = function(c, e, cb) { cb(); };

  var opts = xtend({}, xargs.opts);
  var externalInput = xargs.externalInput;

  if (!opts.stdio) {
    // If externalInput is 0, redirect the child stdin to /dev/null.
    opts.stdio = ['ignore', 'pipe', process.stderr];
    if (externalInput !== 0) opts.stdio[0] = 'pipe';
  }

  var args = xargs.argv;
  var proc = xargs.proc = spawn(xargs.command, args, opts);
  proc.on('error', this.emit.bind(this, 'error'));
  proc.once('exit', this.emit.bind(this, 'exit'));

  xargs.queuedSignals.forEach(function(signal) { proc.kill(signal); });
  xargs.queuedSignals = null;

  this.stdin = proc.stdin;
  this.stdout = proc.stdout;
  this.stderr = proc.stderr;

  var source = xargs.source;
  var buffer = xargs.buffer;
  if (this.stdin) {
    if (source) connectSource(buffer, source, this.stdin);
    else if (xargs.ended) this.stdin.end();
  }

  if (xargs.target) {
    if (this.stdout) this.stdout.pipe(xargs.target);
    else xargs.target.end();
  }
}


XargsStream.prototype._write = function(item, enc, cb) {
  if (this._xargs.externalInput === 0) {
    // No external input, whatever is written here will be used for argv
    appendArgv(this._xargs.argv, item);
  } else {
    this._xargs.buffer.push(item);
  }
  cb();
};


XargsStream.prototype._read = function(size) {
  this._xargs.readRequested = true;
  if (this._xargs.source) this._xargs.source.read();
};


function xargs(argv, opts) {
  return new XargsStream(argv, opts);
}


xargs.spawn = function spawn(argv, opts) {
  return xargs(argv, xtend({}, opts, {input: null}));
};


module.exports = xargs;
