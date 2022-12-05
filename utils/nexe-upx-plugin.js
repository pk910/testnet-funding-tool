const UPX = require('upx');
const fs = require('fs');
const path = require('path');

var upx = UPX({

});

module.exports = (useCompressed) => {
  return (compiler, next) => {
    return new Promise((resolve) => {
      var nodeBinFile = path.join(compiler.options.temp, compiler.options.target);

      if(useCompressed && !fs.existsSync(nodeBinFile + "-org")) {
        fs.renameSync(nodeBinFile, nodeBinFile + "-org");
        if(fs.existsSync(nodeBinFile + "-upx")) {
          fs.renameSync(nodeBinFile + "-upx", nodeBinFile);
          resolve(next());
        }
        else {
          console.log("Compressing node executable '" + compiler.options.target + "'");
          fs.chmodSync(nodeBinFile + "-org", 0755);
          upx(nodeBinFile + "-org").output(nodeBinFile).start().catch((err) => {
            console.log("UPX failed: ");
            console.log(err);
            fs.renameSync(nodeBinFile + "-org", nodeBinFile);
          }).then((stats) => {
            resolve(next());
          });
        }
      }
      else if(!useCompressed && fs.existsSync(nodeBinFile + "-org")) {
        fs.renameSync(nodeBinFile, nodeBinFile + "-upx");
        fs.renameSync(nodeBinFile + "-org", nodeBinFile);
        resolve(next());
      }
      else {
        resolve(next());
      }
    });
  };
}
