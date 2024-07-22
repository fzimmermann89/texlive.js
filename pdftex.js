var TeXLive = function(opt_workerPath) {
  //var self=this;
  var chunksize= determineChunkSize();
  if (!opt_workerPath) {
    opt_workerPath = '';
  }


  var component = function(workerPath) {
    var self = this;
    var worker = new Worker(workerPath);
    self.terminate = function(){worker.terminate()};
    self.initialized=false;
    self.on_stdout = function(msg) {
      console.log(msg);
    }

    self.on_stderr = function(msg) {
      console.log(msg);
    }
    worker.onmessage = function(ev) {
      var data = JSON.parse(ev.data);
      var msg_id;
      if(!('command' in data))
        console.log("missing command!", data);
      switch(data['command']) {
        case 'ready':
          onready.done(true);
          break;
        case 'stdout':
        case 'stderr':
          self['on_'+data['command']](data['contents']);
          break;
        default:
          //console.debug('< received', data);
          msg_id = data['msg_id'];
          if(('msg_id' in data) && (msg_id in promises)) {
            promises[msg_id].done(data['result']);
          }
          else
            console.warn('Unknown worker message '+msg_id+'!');
      }
    }
    var onready = new promise.Promise();
    var promises = [];
    var chunkSize = undefined;
    self.sendCommand = function(cmd) {
      var p = new promise.Promise();
      var msg_id = promises.push(p)-1;
      onready.then(function() {
        cmd['msg_id'] = msg_id;
        worker.postMessage(JSON.stringify(cmd));
      });
      return p;
    };
    self.createCommand = function(command) {
      self[command] = function() {
        var args = [].concat.apply([], arguments);

        return self.sendCommand({
          'command':  command,
          'arguments': args,
        });
      }
    }
    self.createCommand('FS_createDataFile'); // parentPath, filename, data, canRead, canWrite
    self.createCommand('FS_readFile'); // filename
    self.createCommand('FS_unlink'); // filename
    self.createCommand('FS_createFolder'); // parent, name, canRead, canWrite
    self.createCommand('FS_createPath'); // parent, name, canRead, canWrite
    self.createCommand('FS_createLazyFile'); // parent, name, canRead, canWrite
    self.createCommand('FS_createLazyFilesFromList'); // parent, list, parent_url, canRead, canWrite
    self.createCommand('set_TOTAL_MEMORY'); // size
  };

  var pdftex=new component(opt_workerPath+'pdftex-worker.js');
  pdftex.compile = function(source_code) {
    var self=this;
    var p = new promise.Promise();
    pdftex.compileRaw(source_code).then(
      function(binary_pdf) {
        if(binary_pdf === false)
          return p.done(false);
        pdf_dataurl = 'data:application/pdf;charset=binary;base64,' + window.btoa(binary_pdf);
        return p.done(pdf_dataurl);
      });
    return p;
  };
  pdftex.compileRaw = function(source_code) {
     var self=this;
     return pdftex.run(source_code).then(
      function() {
        return self.FS_readFile('/input.pdf');
      }
    );
  };
  pdftex.run = function(source_code) {
    // UTF-8 support: conversation from ISO-8859-1 to UTF-8
    var latin1Array = new TextEncoder().encode(str);
    var utf8Array = new Uint8Array(latin1Array.length * 2);
    var utf8Index = 0;
    for (var i = 0; i < latin1Array.length; i++) {
      var code = latin1Array[i];
      if (code < 128) {
        utf8Array[utf8Index++] = code;
      } else {
        utf8Array[utf8Index++] = 0xc0 | (code >> 6);
        utf8Array[utf8Index++] = 0x80 | (code & 0x3f);
      }
    }
    utf8Array.length = utf8Index;
    var decoder = new TextDecoder('utf-8');
    source_code = decoder.decode(utf8Array);

    var self=this;
    var commands;
    if(self.initialized)
      commands = [
        curry(self, 'FS_unlink', ['/input.tex']),
        curry(self, 'FS_createDataFile', ['/', 'input.tex', source_code, true, true])
      ];
    else
      commands = [
        curry(self, 'FS_createDataFile', ['/', 'input.tex', source_code, true, true]),
        curry(self, 'FS_createLazyFilesFromList', ['/', 'texlive.lst', './texlive', true, true]),
      ];

    var sendCompile = function() {
      self.initialized = true;
      return self.sendCommand({
        'command': 'run',
        'arguments': ['-interaction=nonstopmode', '-output-format', 'pdf', 'input.tex'],
  //        'arguments': ['-debug-format', '-output-format', 'pdf', '&latex', 'input.tex'],
      });
    };
    return promise.chain(commands)
      .then(sendCompile)
  };
  TeXLive.prototype.pdftex = pdftex;

  var bibtex = new component(opt_workerPath+'bibtex-worker.js');
  bibtex.compile = function(aux){
    var self=this;
    var p = new promise.Promise();
    bibtex.compileRaw(aux).then(
      function(binary_bbl) {
        if(binary_bbl === false)
          return p.done(false);
        pdf_dataurl = 'data:text/plain;charset=binary;base64,' + window.btoa(binary_bbl);
        return p.done(pdf_dataurl);
      });
    return p;
  };
  bibtex.compileRaw = function(aux) {
     var self=this;
     return bibtex.run(aux).then(
      function() {
        return self.FS_readFile('/input.bbl');
      }
    );
  };
  bibtex.run = function(source_code) {
    var self=this;
    var commands;
    if(self.initialized)
      commands = [
        curry(self, 'FS_unlink', ['/input.aux']),
        curry(self, 'FS_createDataFile', ['/', 'input.aux', aux, true, true])
      ];
    else
      commands = [
        curry(self, 'FS_createDataFile', ['/', 'input.aux', aux, true, true]),
        curry(self, 'FS_createLazyFilesFromList', ['/', 'texlive.lst', './texlive', true, true]),
      ];
    var sendCompile = function() {
      self.initialized = true;
      return self.sendCommand({
        'command': 'run',
        'arguments': ['input.aux'],
      });
    };
    return promise.chain(commands)
      .then(sendCompile)
  };
  TeXLive.prototype.bibtex=bibtex;
  TeXLive.prototype.terminate = function(){
    pdftex.terminate();
    bibtex.terminate();
  }
};
 var determineChunkSize = function() {
    var size = 1024;
    var max = undefined;
    var min = undefined;
    var delta = size;
    var success = true;
    var buf;

    while(Math.abs(delta) > 100) {
      if(success) {
        min = size;
        if(typeof(max) === 'undefined')
          delta = size;
        else
          delta = (max-size)/2;
      }
      else {
        max = size;
        if(typeof(min) === 'undefined')
          delta = -1*size/2;
        else
          delta = -1*(size-min)/2;
      }
      size += delta;

      success = true;
      try {
        buf = String.fromCharCode.apply(null, new Uint8Array(size));
        sendCommand({
          command: 'test',
          data: buf,
        });
      }
      catch(e) {
        success = false;
      }
    }

    return size;
  };

    curry = function(obj, fn, args) {
    return function() {
      return obj[fn].apply(obj, args);
    }
  }
