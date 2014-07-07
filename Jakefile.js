/*global desc: true, task: true, fail: true, complete: true */

(function() {
  "use strict";

  var childProcess = require('child_process');
  var fs = require('fs');
  var os = require('os');
  var path = require('path');
  var _ = require('underscore');

  desc('Run jslint');
  task('default', ['lint']);

  var backtick = function(command, args, options, callback) {
    var stream = childProcess.spawn(command, args, options);
    var stdoutData = '';
    var stderrData = '';

    stream.stdout.on('data', function(data) {
      if (callback) {
        stdoutData += data;
      } else {
        process.stdout.write(data);
      }
    });

    stream.stderr.on('data', function(data) {
      if (callback) {
        stderrData += data;
      } else {
        process.stderr.write(data);
      }
    });

    if (callback) {
      stream.on('exit', function() {
        callback(stderrData, stdoutData);
      });
    }
  };

  var excludedJSFiles = [
    /node_modules/
  ];

  var getJSFiles = function(callback) {
    var command = ['.', '-name', '*.js'];
    backtick('find', command, null, function(err, out) {
      if (err) { throw new Error(err); }

      var files = out.split('\n');
      files = _.filter(files, function(f) {
        if (!f) { return false; }
        if (f === __dirname) { return false; }

        return excludedJSFiles.every(function(rule) {
          return !f.match(rule);
        });
      });

      callback(files);
    });
  };

  var lint = function(complete) {
    var jshint = require('jshint').JSHINT;

    var commonOptions = {
      //
      // undef: true,
      // asi: false,
      // noarg: true,
      // trailing: false,
      // es5: false,
      // strict: true,
      camelcase: true,
      curly: true,
      eqeqeq: true,
      forin: true,
      immed: true,
      latedef: true,
      newcap: true,
      noempty: true,
      nonew: true,
      quotmark: true,
      regexp: false,
      undef: true,
      unused: true,
      strict: true,
      trailing: true,
      asi: false,
      es5: false,
      evil: false
    };

    var nodeOptions = {
      node: true,
      predef: ['console', 'exports', 'clearTimeout', 'setTimeout', 'setInterval', 'escape', 'unescape']
    };

    // var browserOptions = {
    //   browser: true,
    //   jquery: true,
    //   predef: ['async', '_', 'console', 'window', 'document', "_strawberry", 'require', 'module', 'phantom']
    // };

    var start = new Date().getTime();
    getJSFiles(function(files) {
      console.log("Linting files:");
      _.each(files, function(file) {
        console.log(" " + file);
      });
      // Can't async this since jshint uses globals...
      var errors = files.reduce(function(errors, file) {
        var options = Object.keys(commonOptions).reduce(function(c, key) {
          c[key] = commonOptions[key];
          return c;
        }, {});

        var extraOptions = nodeOptions;
        var isBrowserFile = false;

        Object.keys(extraOptions).forEach(function(key) {
          options[key] = extraOptions[key];
        });

        var fileData = fs.readFileSync(file, 'utf-8');
        var error = {
          file: file.replace(__dirname, '.'),
          errors: []
        };
        if (!jshint(fileData, options)) {
          error.errors = jshint.errors;
        }

        // Custom checks
        fileData.split(/\r?\n/).forEach(function(line, i) {
          // ES5 slipups
          var m = new RegExp(
            'Object\\.keys|\\w+[^)_]\\.(forEach|map|filter|some|reduce|every)\\b'
          ).exec(line);
          if (m && isBrowserFile) {
            error.errors.push({
              line: i+1,
              character: m.index,
              reason: m[0] + ' may not be supported on all browsers ' +
                '(wrap in parens if this is a jQuery object)'
            });
          }

          m = /\w[^)_]\.bind\s*\(\s*function/.exec(line);
          if (m && isBrowserFile) {
            error.errors.push({
              line: i+1,
              character: m.index,
              reason: m[0] + ' may not be supported on all browsers'
            });
          }

          m = /typeof\s*\(/i.exec(line);
          if (m) {
            error.errors.push({
              line: i+1,
              character: m.index,
              reason: 'typeof is not a function (remove parens)'
            });
          }

          m = /\s+$/i.exec(line);
          if (m) {
            error.errors.push({
              line: i+1,
              character: m.index,
              reason: 'line-ending whitespace'
            });
          }
        });

        if (error.errors.length) {
          errors.push(error);
        }

        return errors;
      }, []);

      if (errors.length > 0) {
        errors.forEach(function(error) {
          console.error(error.file);
          error.errors.forEach(function(error) {
            if (!error) { return; }

            console.error('\tline %d col %d: %s',
              error.line, error.character, error.reason);
          });
          console.error();
        });
        fail('Lint errors, quitting.');
      }
      else {
        console.log('Linted %d files in %d ms',
          files.length, new Date().getTime() - start);
        complete();
      }
    });
  };

  desc('Run js lint on all files');
  task('lint', [], function() {
    lint(complete);
  }, true);

  desc('Install node package dependencies local');
  task('deps', [], function() {
    backtick('npm', ['install'], null, function(err, out) {
      if (err.trim().length > 0) { console.error(err); }
      if (out.trim().length > 0) { console.error(out); }
      complete();
    });
  }, true);
}());

