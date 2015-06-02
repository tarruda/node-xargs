var os = require('os');
var path = require('path');
var Readable = require('stream').Readable;

var xtend = require('xtend');
var streamify = require('stream-array');
var str = require('string-to-stream');
var accum = require('accum');
var test = require('tape-catch');
var xargs = require('..');


var fixtures = {
  signal: process.execPath + ' ' + path.join(__dirname, 'fixtures', 'signal.js'),
  text: path.join(__dirname, 'fixtures', 'text.txt')
}



test('xargs', {timeout: 2000}, function(t) {

  function check(description, input, argv, opts, expected) {
    t.test(description, function(t) {
      t.plan(1);

      streamify(input)
        .pipe(xargs(argv, opts))
        .pipe(accum(function(data) {
          t.equal(data.toString(), expected);
        }));
    });
  }

  check('echo arguments without command', ['a1', 'a2', 'a3'], null, null,
        'a1 a2 a3\n'); 

  check('collect arguments and run command with it', ['a1', 'a2', 'a3'],
        ['echo'], null, 'a1 a2 a3\n');

  check('pass string as command', ['a1', 'a2', 'a3'], 'echo', null, 'a1 a2 a3\n');

  check('parse complex command strings', ['a1', 'a2', 'a3'],
    'echo "quoted word 1" quoted\\ word \\2', null,
    'quoted word 1 quoted word 2 a1 a2 a3\n');

  t.test('emits the "exit" event', function(t) {
    t.plan(1);
    streamify(['a1', 'a2'])
      .pipe(xargs('echo')).once('exit', function() { t.ok(true); });
  });

  t.test('signal forwarding', function(t) {
    t.plan(1);
    var proc = streamify(['a1', 'a2'])
      .pipe(xargs(fixtures.signal))
      .once('exit', function() { t.ok(true); });

    setImmediate(function() {
      proc.kill();
    });
  });

  t.test('queues signals', function(t) {
    t.plan(1);
    streamify(['a1', 'a2'])
      .pipe(xargs(fixtures.signal))
      .on('exit', function() { t.ok(true); })
      .kill();
  });

  t.test('normal spawn(null input)', function(t) {
    t.plan(1);
    str('normal spawn')
      .pipe(xargs.spawn('cat -'))
      .pipe(accum(function(data) {
        t.equal(data.toString(), 'normal spawn');
      }));
  });

  t.test('with external input', function(t) {
    t.plan(2);
    str('normal spawn\n')
      .pipe(xargs('cat -', {input: streamify([fixtures.text])}))
      .pipe(accum(function(data) {
        t.equal(data.toString(), 'normal spawn\n1\n1 2\n1 2 3\n');
      }));

    str('normal spawn\n')
      .pipe(xargs(['cat', fixtures.text],
                  {input: streamify(['-', fixtures.text])}))
      .pipe(accum(function(data) {
        t.equal(data.toString(), '1\n1 2\n1 2 3\nnormal spawn\n1\n1 2\n1 2 3\n');
      }));
  });
});
