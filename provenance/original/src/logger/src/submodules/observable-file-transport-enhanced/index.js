'use strict';

import ObservableFileTransport from '../observable-file-transport/index.js';

class ObservableFileTransportEnhanced extends ObservableFileTransport {
  constructor(options = {}) {
    super({
      compress: options.compress ?? options.compressOnRotate ?? false,
      ...options,
    });
    this.compress = this.delegate.compressOnRotate;
    this.fileNamePattern = this.delegate.fileNamePattern;
  }

  _compressFile(file) {
    return this.delegate._compress(file);
  }
}

export default ObservableFileTransportEnhanced;
