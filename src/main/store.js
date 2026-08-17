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
  mods: {},
  // Новая структура для аккаунтов
  accounts: [],
  activeAccountId: null
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (e) { /* noop */ }
    // Миграция: если старый формат (без accounts), создаем оффлайн-аккаунт
    if (this.data.accounts.length === 0 && this.data.username) {
      this.data.accounts = [{
        id: 'offline-' + Date.now(),
        username: this.data.username,
        userType: 'legacy',
        accessToken: '0',
        uuid: '00000000-0000-0000-0000-000000000000'
      }];
      this.data.activeAccountId = this.data.accounts[0].id;
      this.save();
    }
  }

  get(key) { return this.data[key]; }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) { /* noop */ }
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  // Методы работы с аккаунтами

  addAccount(account) {
    const id = account.id || 'account-' + Date.now();
    const data = { ...account, id };
    this.data.accounts.push(data);
    this.data.activeAccountId = id;
    this.save();
    return id;
  }

  removeAccount(accountId) {
    const index = this.data.accounts.findIndex(a => a.id === accountId);
    if (index === -1) return false;
    // Нельзя удалить единственный аккаунт (оставить хотя бы оффлайн)
    if (this.data.accounts.length <= 1) return false;
    this.data.accounts.splice(index, 1);
    // Если удаляли активный, выбираем первый оставшийся
    if (this.data.activeAccountId === accountId) {
      this.data.activeAccountId = this.data.accounts.length > 0 ? this.data.accounts[0].id : null;
    }
    this.save();
    return true;
  }

  setActiveAccount(accountId) {
    const account = this.data.accounts.find(a => a.id === accountId);
    if (!account) return false;
    this.data.activeAccountId = accountId;
    this.data.username = account.username;
    this.save();
    return true;
  }

  getActiveAccount() {
    if (this.data.activeAccountId) {
      return this.data.accounts.find(a => a.id === this.data.activeAccountId) || null;
    }
    // Fallback: return first account or create default
    if (this.data.accounts.length > 0) return this.data.accounts[0];
    return null;
  }

  accountsList() {
    return this.data.accounts.map(a => ({
      id: a.id,
      username: a.username,
      userType: a.userType,
      // Не exposing accessToken и uuid в списке для безопасности
    }));
  }
}

module.exports = new Store();