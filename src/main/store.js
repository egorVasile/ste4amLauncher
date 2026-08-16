'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  username: 'Player',
  ram: 2,
  mirror: 'auto',
  javaPath: '',
  language: 'ru',
  showSnapshots: true,
  optimize: true,
  jvmArgs: '',
  closeLauncherOnGame: false,
  showOldVersions: false,
  mods: {}
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (e) { /* noop */ }
  }
  get(key) { return this.data[key]; }
  set(key, value) {
    this.data[key] = value;
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) { /* noop */ }
  }
}

module.exports = new Store();
