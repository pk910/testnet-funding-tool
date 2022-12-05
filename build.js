const { webpack } = require('webpack');
const { compile } = require('nexe');
const { minify } = require("terser");
var path = require('path');
var fs = require('fs');
const TerserPlugin = require('terser-webpack-plugin');
const nexeUpxPlugin = require('./utils/nexe-upx-plugin');

var cliArgs = (function() {
  var args = {};
  var arg, key;
  for(var i = 0; i < process.argv.length; i++) {
      if((arg = /^--([^=]+)(?:=(.+))?$/.exec(process.argv[i]))) {
          key = arg[1];
          args[arg[1]] = arg[2] || true;
      }
      else if(key) {
          args[key] = process.argv[i];
          key = null;
      }
  }
  return args;
})();
var debugMode = !!cliArgs['debug'];

const deleteFolderRecursive = function(cpath) {
  if (fs.existsSync(cpath)) {
    fs.readdirSync(cpath).forEach((file, index) => {
      const curPath = path.join(cpath, file);
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(cpath);
  }
};

var srcBasePath = path.join(__dirname, "src");
if (!fs.existsSync(srcBasePath))
  throw "src path not found";

var buildPath = path.join(__dirname, "build");
if (!fs.existsSync(buildPath))
  fs.mkdirSync(buildPath);

var releasePath = path.join(__dirname, "release");
if (!fs.existsSync(releasePath))
  fs.mkdirSync(releasePath);


function buildClient() {
  console.log("Building Client to '" + releasePath + "'");

  return (new Promise((resolve, reject) => {
    webpack({
      entry: path.join(srcBasePath, 'funding-tool.js'),
      target: 'node',
      mode: debugMode ? 'development' : 'production',
      output: { 
        path: buildPath,
        filename: "app.js"
      },
    }, (err, stats) => {
      if(stats && stats.hasErrors())
        console.error("webpack error", stats.compilation.errors);
      if (err)
        reject(err);
      else
        resolve();
    });
  })).then(() => {
    let cliBuildList = [
      {
        arch: 'linux-x64',
        output: 'funding-tool-amd64',
        target: 'linux-x64-14.15.3'
      },
      {
        arch: 'linux-x86',
        output: 'funding-tool-x86',
        target: 'linux-x86-14.15.3'
      },
      {
        arch: 'win32-x64',
        output: 'funding-tool-win64.exe',
        target: 'windows-x64-14.15.3'
      },
      {
        arch: 'win32-x86',
        output: 'funding-tool-win32.exe',
        target: 'windows-x86-14.15.3'
      },
    ];

    console.log("Building Client Executable to '" + releasePath + "'");
    return Promise.all(cliBuildList.map((cliBuild) => {
      return compile({
        input: path.join(buildPath, 'app.js'),
        output: path.join(releasePath, cliBuild.output),
        target: cliBuild.target,
        temp: buildPath,
        silent: true,
        resources: [ path.join(buildPath, 'app.js') ],
        plugins: [ nexeUpxPlugin(!debugMode) ]
      });
    }));
  }).then(() => {
    console.log("build complete");
  });
}

buildClient().then(() => {
  console.log('success')
}, (err) => {
  console.log('error', err)
});

