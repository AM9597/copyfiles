'use strict';
var path = require('path');
var fs = require('fs');
const fg = require('fast-glob');
var mkdirp = require('mkdirp');
var untildify = require('untildify');
var through = require('through2').obj;
var noms = require('noms').obj;
function toStream(_array) {
  var array = _array.filter(item=>item!==null)
  var length = array.length;
  var i = 0;
  return noms(function (done) {
    if (i >= length) {
      this.push(null);
    }
    this.push(array[i++]);
    done();
  });
}
function depth(string) {
  return path.normalize(string).split(path.sep).length - 1;
}
function dealWith(inPath, up) {
  if (!up) {
    return inPath;
  }
  if (up === true) {
    return path.basename(inPath);
  }
  if (depth(inPath) < up) {
    throw new Error('cant go up that far');
  }
  return path.join.apply(path, path.normalize(inPath).split(path.sep).slice(up));
}
var copyFile = _copyFile;
function _copyFile (src, dst, opts, callback) {
  fs.createReadStream(src)
    .pipe(fs.createWriteStream(dst, {
      mode: opts.mode
    }))
    .once('error', callback)
    .once('finish', function () {
      fs.chmod(dst, opts.mode, function (err) {
        callback(err);
      })
    })
}
if (fs.copyFile) {
  copyFile = function (src, dst, opts, callback) {
    fs.copyFile(src, dst, callback);
  }
}
function makeDebug(config) {
  if (config.verbose) {
    return function (thing) {
      console.log(thing);
    }
  }
  return function () {}
}
module.exports = copyFiles;
function copyFiles(args, config, callback) {
  if (typeof config === 'function') {
    callback = config;
    config = {
      up:0
    };
  }
  if (typeof config !== 'object' && config) {
    config = {
      up: config
    };
  }
  var debug = makeDebug(config);
  var copied = false;
  var opts = config.up || 0;
  var soft = config.soft;
  if (typeof callback !== 'function') {
    throw new Error('callback is not optional');
  }
  var input = args.slice();
  var outDir = input.pop();
  var globOpts = {};
  if (config.exclude) {
    globOpts.ignore = config.exclude;
  }
  if (config.all) {
    globOpts.dot = true;
  }
  if (config.follow) {
    globOpts.follow = true;
  }
  outDir = outDir.startsWith('~') ? untildify(outDir) : outDir;
  toStream(input.map(function(srcP) {return srcP.startsWith('~') ? untildify(srcP) : srcP;}))
  .pipe(through(function (pathName, _, next) {
    var self = this;
    fg(pathName, globOpts)
    .then(paths => {
      // Iterate over the unglobbed paths
      paths.forEach(unglobbedPath => {
        debug(`unglobbed path: ${unglobbedPath}`);
        self.push(unglobbedPath); // Assuming self.push is some kind of stream or data handler
      });
      next(); // Calling the next function when done
    })
    .catch(err => {
      next(err); // Handle errors if the glob fails
    });
  }))
  .on('error', callback)
  .pipe(through(function (pathName, _, next) {
    fs.stat(pathName, function (err, pathStat) {
      if (err) {
        return next(err);
      }
      var outName = path.join(outDir, dealWith(pathName, opts));
      function done(){
        mkdirp(path.dirname(outName)).then(()=>{
          next(null, {
            pathName: pathName,
            pathStat: pathStat
          });
        }, next);
      }
      if (pathStat.isDirectory()) {
        debug(`skipping, is directory: ${pathName}`)
        return next();
      }
      if (!pathStat.isFile()) {
        return next(new Error('how can it be neither file nor folder?'))
      }
      if (!soft) {
        return done();
      }
      fs.stat(outName, function(err){
        if(!err){
          //file exists
          return next()
        }
        if (err.code === 'ENOENT') {
          //file does not exist
          return done();
        }
        // other error
        return next(err)
      })
    });
  }))
  .on('error', callback)
  .pipe(through(function (obj, _, next) {

    if (!copied) {
      copied = true;
    }
    var pathName = obj.pathName;
    var pathStat = obj.pathStat;
    var outName = path.join(outDir, dealWith(pathName, opts));
    debug(`copy from: ${pathName}`)
    debug(`copy to: ${outName}`)
    copyFile(pathName, outName, pathStat, next)
  }))
  .on('error', callback)
  .on('finish', function () {
    if (config.error && !copied) {
      return callback(new Error('nothing copied'));
    }
    callback();
  });
}
