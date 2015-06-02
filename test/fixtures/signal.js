var t = setTimeout(function() { }, 5000);

process.on('SIGTERM', function() { clearTimeout(t); });
