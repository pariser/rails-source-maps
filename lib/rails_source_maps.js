#!/usr/bin/env node

var fs = require('fs');
var zlib = require('zlib');
var _ = require('underscore');
var async = require('async');
var program = require('commander');
var uglify = require('uglify-js');
var glob = require('glob');

var AlreadyProcessedError = function() {};

var threads = program.threads || 3;
var gzip = program.gzip;

exports.main = function() {
  program
    .version('0.0.1')
    .option('-t, --threads [threads]', 'number of concurrent threads (default: 3)')
    .option('-Z, --no-gzip', 'do not gzip files')
    .usage('/path/to/rails/root')
    .parse(process.argv);

  this.setupQueue();

  if (program.args.length < 1 || !_.isString(program.args[0])) {
    return program.help();
  }

  this.run();
};

exports.run = function() {
  var self = this;

  self.assetsPath = program.args[0].replace(/\/$/, '') + '/public/assets';

  async.series([
    function(cb) {
      fs.stat(self.assetsPath, function(err, stat) {
        if (err) {
          return cb(err);
        }

        if (!stat.isDirectory()) {
          return cb(new Error('Input is not a directory: ' + self.assetsPath + "\n\n"));
        }

        cb();
      });
    },
    function(cb) {
      glob(self.assetsPath + "/**/*.js", function(err, files) {
        if (err) {
          return console.error("Encountered error walking directory tree: " + err.toString());
        }

        var jsfiles = _.select(files, function(file) {
          if (file.match(/\.js$/) && !file.match(/\.orig\.js$/)) {
            return true;
          }
        });

        self.hashedFiles = [];
        self.nonHashedFiles = [];

        _.each(jsfiles, function(file) {
          if (/[0-9a-f]{32}/.test(file)) {
            self.hashedFiles.push(file);
          } else {
            self.nonHashedFiles.push(file);
          }
        });

        _.each(self.hashedFiles, function(file) {
          self.queue.push(file);
        });
      });
    }
  ], function(err) {
    if (err) {
      console.error(err);
      program.help();
    }
  });
};

exports.setupQueue = function() {
  this.queue = async.queue(_.bind(this.enqueue, this), threads);
  this.queue.drain = _.bind(this.onQueueDrain, this);
};

/* ****************************************************************
  Process each javascript file using this queue
**************************************************************** */
exports.enqueue = function(jsfile, cb) {
  var self = this;

  var original = jsfile.replace(/\.js$/, '.orig.js');
  var sourcemap = jsfile.replace(/\.js$/, '.js.map');
  var gzipped = jsfile.replace(/\.js$/, '.js.gz');

  var sourceMapUrl = sourcemap.replace(/^((\.\/)?public\/)?/, '/');
  var sourceMapText = "\n//# sourceMappingURL=" + sourceMapUrl;

  async.waterfall([
    function(cb) {
      fs.readFile(jsfile, { encoding: 'utf8' }, function(err, contents) {
        if (err) {
          return cb(err);
        }

        // Check if this file already lists a source map. If so, skip it.
        if (contents.slice(-1 * sourceMapText.length) === sourceMapText) {
          console.log("Skipping file which already has a source map:", jsfile);
          return cb(new AlreadyProcessedError());
        }

        console.log("Generating source map for file:", jsfile);
        cb();
      });
    },
    function(cb) {
      fs.rename(jsfile, original, cb);
    },
    function(cb) {
      var uglified = uglify.minify(original, {
        outSourceMap: sourceMapUrl
      });
      cb(null, uglified);
    },
    function(uglified, cb) {
      // Replace ./public/assets/ prefix with /assets/
      uglified.code = uglified.code.replace(/\.?\/?public\/assets\//g, '/assets/');
      uglified.map = uglified.map.replace(/\.?\/?public\/assets\//g, '/assets/');

      uglified.code += sourceMapText;

      var flags = {
        code: false,
        map: false,
        cb: false
      };

      var finished = function(which) {
        return function(err) {
          if (err) {
            flags.cb = true;
            return cb(err);
          }
          flags[which] = true;
          if (flags.code && flags.map && !flags.cb) {
            flags.cb = true;
            cb();
          }
        };
      };

      fs.writeFile(jsfile, uglified.code, finished('code'));
      fs.writeFile(sourcemap, uglified.map, finished('map'));
    },
    function(cb) {
      self.gzip(jsfile, gzipped, cb);
    }
  ], function(err) {
    if (err) {
      if (err instanceof AlreadyProcessedError) {
        return cb();
      }

      console.error("Error processing file " + jsfile + ": " + err.toString());
      return cb(err);
    }

    cb();
  });
};

exports.gzip = function(source, dest, cb) {
  if (!gzip) {
    return cb();
  }

  fs.createReadStream(source).
    pipe(zlib.createGzip()).
    pipe(fs.createWriteStream(dest)).
    on('finish', cb);
};

exports.processNonHashedFiles = function(cb) {
  var self = this;

  var originalFileContentHash = {};

  async.waterfall([
    // read all of the .orig files
    function(cb) {
      glob(self.assetsPath + "/**/*.orig.js", cb)
    },
    // store all of the files in a hash
    function(files, cb) {
      async.each(files, function(file, cb) {
        fs.readFile(file, function(err, contents) {
          if (err) {
            return cb(err);
          }

          originalFileContentHash[contents] = file;
          cb();
        });
      }, function(err) {
        cb(err);
      });
    },
    function(cb) {
      // process each file
      async.forEachSeries(self.nonHashedFiles, function(jsfile, cb) {
        var original = jsfile.replace(/\.js$/, '.orig.js');
        var sourcemap = jsfile.replace(/\.js$/, '.js.map');
        var gzipped = jsfile.replace(/\.js$/, '.js.gz');

        var sourceOrig;

        async.waterfall([
          // does the .orig already exist?  If so, skip it
          function(cb) {
            fs.exists(original, function(exists) {
              if (exists) {
                return cb(new AlreadyProcessedError());
              }

              return cb();
            });
          },
          // read the file contents
          function(cb) {
            fs.readFile(jsfile, cb);
          },
          // pick out the orig files with the same contents
          // if not, throw an error.
          function(contents, cb) {
            sourceOrig = originalFileContentHash[contents];

            if (!sourceOrig) {
              return cb(new Error("Could not find original hashed file for: " + jsfile));
            }

            console.log("Reusing source maps for file:", jsfile, 'from file:', sourceOrig);

            cb();
          },
          // rename the jsfile to .orig
          function(cb) {
            fs.rename(jsfile, original, cb);
          },
          // copy the hashed version
          function(cb) {
            self.copy(sourceOrig.replace('.orig', ''), jsfile, cb);
          },
          // copy the gziped version
          function(cb) {
            if (!gzip) {
              return cb();
            }

            self.copy(sourceOrig.replace('.orig.js', '.js.gz'), gzipped, cb);
          }
        ], function(err) {
          if (err && err instanceof AlreadyProcessedError) {
            console.log("Skipping file which already has a source map:", jsfile);
            return cb();
          }

          cb(err);
        });
      }, cb);
    }
  ], cb);
};

exports.copy = function(source, dest, cb) {
  var readStream = fs.createReadStream(source);
  var writeStream = fs.createWriteStream(dest);

  readStream.on('error', cb);
  writeStream.on('error', cb);
  writeStream.on("close", cb);

  readStream.pipe(writeStream);
};

exports.onQueueDrain = function() {
  this.processNonHashedFiles(function(err) {
    if (err) {
      throw err;
    }

    console.log('all files have been processed');
  });
};
