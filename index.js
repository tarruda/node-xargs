var os = require('os');
var spawn = require('child_process').spawn;
var inherits = require('util').inherits;
var Duplex = require('stream').Duplex;

var xtend = require('xtend');
var parse = require('shell-quote').parse;


function XargsStream(argv, opts) {
  Duplex.call(this);

  if (typeof argv === 'string') {
    argv = parse(argv);
  }

  argv = argv || [];
  opts = opts || {};

  this._xargs = {
    command: argv[0],
    argv: argv,
    opts: opts,
    proc: null,
    source: null,
    target: null,
    collected: [],
    queuedSignals: []
  };

  this.once('pipe', this._on_pipe.bind(this));
  this.once('finish', this._spawn.bind(this));
}
inherits(XargsStream, Duplex);


XargsStream.prototype.kill = function(signal) {
  if (this._xargs.proc) {
    this._xargs.proc.kill(signal);
  } else {
    this._xargs.queuedSignals.push(signal);
  }
};


XargsStream.prototype.pipe = function(target) {
  this._xargs.target = target;
  if (this.stdout) this.stdout.pipe(this._xargs.target);
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

  if (!this._xargs.command) {
    // emulate xargs behavior when no command is passed(`echo` is called with
    // the collected arguments)
    Duplex.prototype.pipe.call(this, this._xargs.target);
    this.push(this._xargs.collected.join(' '));
    this.push(os.EOL);
    this.push(null);
    return;
  }

  var args = this._xargs.argv.slice(1).concat(this._xargs.collected);
  var opts = xtend({}, this._xargs.opts);

  if (!opts.stdio) opts.stdio = ['ignore', 'pipe', process.stderr];

  var proc = this._xargs.proc = spawn(this._xargs.command, args, opts);

  proc.on('error', this.emit.bind(this, 'error'));
  proc.on('exit', this.emit.bind(this, 'exit'));
  proc.stdout.on('close', this.emit.bind(this, 'close'));

  this._xargs.queuedSignals.forEach(function(signal) { proc.kill(signal); });
  this._xargs.queuedSignals = null;

  this.stdin = proc.stdin;
  this.stdout = proc.stdout;
  this.stderr = proc.stderr;

  if (this._xargs.target) {
    if (this.stdout) this.stdout.pipe(this._xargs.target);
    else this._xargs.target.end();
  }
}


XargsStream.prototype._write = function(item, enc, cb) {
  item = item.toString();
  if (item) this._xargs.collected.push(item);
  cb();
};


XargsStream.prototype._read = function(size) {
  return this._xargs.source.read(size);
};


module.exports = function xargs(argv, opts) {
  return new XargsStream(argv, opts);
};
