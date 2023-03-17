import Value from './Value.js';
import {genUri} from './Util.js';

export default class Model {
  #resource;

  constructor (resource) {
    this.#resource = resource;
    if (typeof resource === 'string') {
      this.id = resource;
      this.isNew(false);
    } else if (typeof resource === 'undefined') {
      this.id = genUri();
    } else if (typeof resource === 'object') {
      Object.getOwnPropertyNames(resource).forEach((prop) => {
        if (prop === '@' || prop === 'id') {
          return this.id = resource.id ?? resource['@'];
        }
        const value = resource[prop];
        this[prop] = Array.isArray(value) ? value.map(Value.parse) : Value.parse(value);
      });
    }
  }

  toJSON () {
    const keys = Object.getOwnPropertyNames(this);
    const json = keys.reduce((acc, key) => {
      if (key === 'id') {
        acc['@'] = this.id;
        return acc;
      }
      const value = this[key];
      if (value instanceof Function) {
        return acc;
      } else if (Array.isArray(value)) {
        acc[key] = value.filter(Boolean).map(Value.serialize);
        if (!acc[key].length) delete acc[key];
      } else {
        acc[key] = [Value.serialize(value)].filter(Boolean);
        if (!acc[key].length) delete acc[key];
      }
      return acc;
    }, {});
    return json;
  }

  #isNew = true;
  isNew (value) {
    return typeof value === 'undefined' ? this.#isNew : this.#isNew = !!value;
  }

  #isLoaded = false;
  isLoaded (value) {
    return typeof value === 'undefined' ? this.#isLoaded : this.#isLoaded = !!value;
  }

  #isSync = false;
  isSync (value) {
    return typeof value === 'undefined' ? this.#isSync : this.#isSync = !!value;
  }

  get (prop) {
    return this[prop];
  }

  set (prop, value) {
    this[prop] = value;
  }

  clearValue (prop) {
    delete this[prop];
  }

  addValue (prop, value) {
    if (!this.hasValue(prop)) {
      this[prop] = value;
    } else {
      const existingValue = this[prop];
      if (Array.isArray(existingValue)) {
        existingValue.push(value);
      } else {
        this[prop] = [existingValue, value];
      }
    }
  }

  hasValue (prop, value) {
    if (!prop && typeof value !== 'undefined') {
      return Object.getOwnPropertyNames(this).reduce((prev, prop) => prev || this.hasValue(prop, value), false);
    }
    let found = !!(typeof this[prop] !== 'undefined');
    if (typeof value !== 'undefined' && value !== null) {
      const serialized = Value.serialize(value);
      let propValue = this[prop];
      if (propValue instanceof Function) return false;
      propValue = Array.isArray(propValue) ? propValue : [propValue];
      found = found && propValue.some((item) => serialized.isEqual(Value.serialize(item)));
    }
    return found;
  }

  removeValue (prop, value) {
    if (!prop && typeof value !== 'undefined') {
      return Object.getOwnPropertyNames(this).forEach((prop) => this.removeValue(prop, value));
    }
    if (this.hasValue(prop, value)) {
      if (Array.isArray(this[prop])) {
        const serializedValue = Value.serialize(value);
        this[prop] = this[prop].filter((item) => !serializedValue.isEqual(Value.serialize(item)));
        if (!this[prop].length) delete this[prop];
      } else {
        delete this[prop];
      }
    }
  }

  load () {
  }

  reset () {
  }

  save () {
  }

  remove () {
  }
}
