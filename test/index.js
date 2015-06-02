var os = require('os');
var streamify = require('stream-array');
var accum = require('accum');
var test = require('tape');
var xargs = require('..');


function t(description, input, argv, opts, expected) {
  test(description, function(t) {
    t.plan(1);

    streamify(input)
      .pipe(xargs(argv, opts))
      .pipe(accum(function(data) {
        t.deepEqual(data.toString(), expected);
      }));
  });
}

t('echo arguments without command', ['a1', 'a2', 'a3'], null, null, 'a1 a2 a3\n'); 

t('collect arguments and run command with it', ['a1', 'a2', 'a3'], ['echo'], null,
  'a1 a2 a3\n');

t('pass string as command', ['a1', 'a2', 'a3'], 'echo', null, 'a1 a2 a3\n');

t('parse complex command strings', ['a1', 'a2', 'a3'],
  'echo "quoted word 1" quoted\\ word \\2', null,
  'quoted word 1 quoted word 2 a1 a2 a3\n');

test('emits the "exit" event', function(t) {
  streamify(['a1', 'a2'])
    .pipe(xargs('echo'))
    .on('exit', function() { t.end(); });
});

test('forwards signals', function(t) {
  var proc = streamify([])
    .pipe(xargs('cat', {stdio: ['pipe', 'pipe', process.stderr]}))
    .on('exit', function() { t.end(); });

  setImmediate(function() {
    proc.kill();
  });
});

test('queues signals', function(t) {
  streamify([])
    .pipe(xargs('cat', {stdio: ['pipe', 'pipe', process.stderr]}))
    .on('exit', function() { t.end(); }).kill();
});
