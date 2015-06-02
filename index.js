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
        // Attach handlers on next tick to prevent the 'end' event handler being
        // fired before a synchronous input stream could pipe to this stream.
        externalInput.on('data', appendArgv.bind(null, xargs.argv));
        externalInput.once('end', spawn);
      });
    } else {
      // When external input is specified as a falsy value, we don't try to
      // collect arguments from any stream and perform a more standard child
      // process spawn.
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


XargsStream.prototype.pipe = function(target) {
  this._xargs.target = target;
  if (this.stdout) this.stdout.pipe(this._xargs.target);
  return target;
};


XargsStream.prototype.unpipe = function(target) {
  if (this.stdout && this._xargs.target) this.stdout.unpipe(target);
};


XargsStream.prototype._on_pipe = function(source) {
  this._xargs.source = source;
};


XargsStream.prototype._spawn = function() {
  this._read = function() {};
  this._write = function(c, e, cb) { cb(); };

  var xargs = this._xargs;
  var opts = xtend({}, xargs.opts);
  var source = xargs.source;
  var externalInput = xargs.externalInput;

  if (!opts.stdio) {
    // If externalInput is 0, redirect the child stdin to /dev/null.
    opts.stdio = ['ignore', 'pipe', process.stderr];
    if (source && externalInput !== 0) opts.stdio[0] = 'pipe';
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

  if (this.stdin) {
    var buffer = xargs.buffer;
    // take all buffered chunks and the source stream and pipe into the spawned
    // process stdin
    var chunkStream = streamify(buffer);
    chunkStream.once('end', source.pipe.bind(source, this.stdin))
    chunkStream.pipe(this.stdin, {end: false});
  }

  if (xargs.target) {
    if (this.stdout) {
      this.stdout.pipe(xargs.target);
      this.stdout.once('close', this.emit.bind(this, 'close'));
    } else {
      xargs.target.end();
    }
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
  return this._xargs.source.read();
};


function xargs(argv, opts) {
  return new XargsStream(argv, opts);
}


xargs.spawn = function spawn(argv, opts) {
  return xargs(argv, xtend({}, opts, {input: null}));
};


module.exports = xargs;
