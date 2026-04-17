'use strict';

const { EventEmitter } = require('events');
const Redis = require('ioredis');
require('dotenv').config();

function wildcardToRegex(pattern) {
    const escaped = String(pattern)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
}

class InMemoryRedisClient extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
        this.store = new Map();
        this.hashes = new Map();
        this.sets = new Map();
        this.expiries = new Map();

        process.nextTick(() => this.emit('connect'));
    }

    _prefixKey(key) {
        return `${this.options.keyPrefix || ''}${key}`;
    }

    _dropExpired(fullKey) {
        const expiresAt = this.expiries.get(fullKey);
        if (expiresAt && Date.now() >= expiresAt) {
            this.expiries.delete(fullKey);
            this.store.delete(fullKey);
            this.hashes.delete(fullKey);
            this.sets.delete(fullKey);
        }
    }

    _ensureSet(fullKey) {
        this._dropExpired(fullKey);
        if (!this.sets.has(fullKey)) {
            this.sets.set(fullKey, new Set());
        }
        return this.sets.get(fullKey);
    }

    _ensureHash(fullKey) {
        this._dropExpired(fullKey);
        if (!this.hashes.has(fullKey)) {
            this.hashes.set(fullKey, {});
        }
        return this.hashes.get(fullKey);
    }

    _getStoredValue(fullKey) {
        this._dropExpired(fullKey);
        return this.store.get(fullKey);
    }

    async get(key) {
        return this._getStoredValue(this._prefixKey(key)) ?? null;
    }

    async set(key, value, ...args) {
        const fullKey = this._prefixKey(key);
        this._dropExpired(fullKey);

        let nx = false;
        let px;
        let ex;
        for (let i = 0; i < args.length; i += 1) {
            const token = String(args[i] || '').toUpperCase();
            if (token === 'NX') nx = true;
            if (token === 'PX') px = Number(args[i + 1]);
            if (token === 'EX') ex = Number(args[i + 1]);
        }

        if (nx && (this.store.has(fullKey) || this.hashes.has(fullKey) || this.sets.has(fullKey))) {
            return null;
        }

        this.hashes.delete(fullKey);
        this.sets.delete(fullKey);
        this.store.set(fullKey, String(value));

        if (Number.isFinite(px) && px > 0) {
            this.expiries.set(fullKey, Date.now() + px);
        } else if (Number.isFinite(ex) && ex > 0) {
            this.expiries.set(fullKey, Date.now() + (ex * 1000));
        } else {
            this.expiries.delete(fullKey);
        }

        return 'OK';
    }

    async setex(key, ttlSeconds, value) {
        return this.set(key, value, 'EX', ttlSeconds);
    }

    async del(...keys) {
        let deleted = 0;
        for (const key of keys) {
            const fullKey = this._prefixKey(key);
            const existed = this.store.delete(fullKey) || this.hashes.delete(fullKey) || this.sets.delete(fullKey);
            this.expiries.delete(fullKey);
            if (existed) deleted += 1;
        }
        return deleted;
    }

    async expire(key, ttlSeconds) {
        const fullKey = this._prefixKey(key);
        const exists = this.store.has(fullKey) || this.hashes.has(fullKey) || this.sets.has(fullKey);
        if (!exists) return 0;
        this.expiries.set(fullKey, Date.now() + (Number(ttlSeconds) * 1000));
        return 1;
    }

    async incr(key) {
        return this.incrby(key, 1);
    }

    async incrby(key, increment) {
        const fullKey = this._prefixKey(key);
        const current = Number(this._getStoredValue(fullKey) || 0);
        const next = current + Number(increment);
        this.store.set(fullKey, String(next));
        this.hashes.delete(fullKey);
        this.sets.delete(fullKey);
        return next;
    }

    async hget(key, field) {
        const hash = this.hashes.get(this._prefixKey(key));
        return hash && Object.prototype.hasOwnProperty.call(hash, field) ? hash[field] : null;
    }

    async hmget(key, fields) {
        const list = Array.isArray(fields) ? fields : Array.from(arguments).slice(1);
        const hash = this.hashes.get(this._prefixKey(key)) || {};
        return list.map((field) => (Object.prototype.hasOwnProperty.call(hash, field) ? hash[field] : null));
    }

    async hgetall(key) {
        const hash = this.hashes.get(this._prefixKey(key));
        return hash ? { ...hash } : {};
    }

    async hmset(key, values) {
        const fullKey = this._prefixKey(key);
        const hash = this._ensureHash(fullKey);
        Object.entries(values || {}).forEach(([field, value]) => {
            hash[field] = String(value);
        });
        this.store.delete(fullKey);
        this.sets.delete(fullKey);
        return 'OK';
    }

    async sadd(key, ...values) {
        const fullKey = this._prefixKey(key);
        const set = this._ensureSet(fullKey);
        values.flat().forEach((value) => set.add(String(value)));
        this.store.delete(fullKey);
        this.hashes.delete(fullKey);
        return set.size;
    }

    async smembers(key) {
        const set = this.sets.get(this._prefixKey(key));
        return set ? Array.from(set) : [];
    }

    async publish() {
        return 1;
    }

    async ping() {
        return 'PONG';
    }

    async config() {
        return 'OK';
    }

    async keys(pattern) {
        const regex = wildcardToRegex(pattern);
        const allKeys = new Set([
            ...this.store.keys(),
            ...this.hashes.keys(),
            ...this.sets.keys()
        ]);
        return Array.from(allKeys).filter((key) => {
            this._dropExpired(key);
            return regex.test(key);
        });
    }

    async scan(cursor, ...args) {
        let pattern = '*';
        for (let i = 0; i < args.length; i += 1) {
            if (String(args[i]).toUpperCase() === 'MATCH') {
                pattern = args[i + 1] || '*';
            }
        }
        const keys = await this.keys(pattern);
        return ['0', keys];
    }

    pipeline() {
        const client = this;
        const queue = [];
        const pipeline = {
            sadd(...args) {
                queue.push(() => client.sadd(...args));
                return pipeline;
            },
            hmset(...args) {
                queue.push(() => client.hmset(...args));
                return pipeline;
            },
            expire(...args) {
                queue.push(() => client.expire(...args));
                return pipeline;
            },
            get(...args) {
                queue.push(() => client.get(...args));
                return pipeline;
            },
            hgetall(...args) {
                queue.push(() => client.hgetall(...args));
                return pipeline;
            },
            exec: async () => {
                const results = [];
                for (const task of queue) {
                    try {
                        results.push([null, await task()]);
                    } catch (error) {
                        results.push([error, null]);
                    }
                }
                return results;
            }
        };
        return pipeline;
    }

    async eval(script, numberOfKeys, ...args) {
        if (script.includes('if redis.call("get", KEYS[1]) == ARGV[1] then')) {
            const key = args[0];
            const token = args[1];
            const current = await this.get(key);
            if (current === token) {
                await this.del(key);
                return 1;
            }
            return 0;
        }

        if (script.includes('local path = ARGV[1]') && script.includes('redis.call(\'SET\', KEYS[1], cjson.encode(obj))')) {
            const [key, fieldPath, condition, expectedValue, newValue, incrementBy] = args;
            const raw = await this.get(key);
            if (!raw) return 'KEY_NOT_FOUND';

            let obj;
            try {
                obj = JSON.parse(raw);
            } catch (_error) {
                return 'KEY_NOT_FOUND';
            }

            const parts = String(fieldPath).split('.');
            let current = obj;
            for (let i = 0; i < parts.length - 1; i += 1) {
                const part = parts[i];
                if (!current || typeof current !== 'object' || !(part in current)) {
                    return 'KEY_NOT_FOUND';
                }
                current = current[part];
            }

            const lastField = parts[parts.length - 1];
            const currentValue = current ? current[lastField] : undefined;

            const normalizeLuaValue = (value) => {
                if (value === 'nil') return null;
                if (value === 'true') return true;
                if (value === 'false') return false;
                if (value === null || value === undefined) return value;
                const asNumber = Number(value);
                if (!Number.isNaN(asNumber) && String(value).trim() !== '') return asNumber;
                return value;
            };

            const expected = normalizeLuaValue(expectedValue);
            let conditionMet = false;
            switch (condition) {
                case 'eq': conditionMet = currentValue === expected; break;
                case 'neq': conditionMet = currentValue !== expected; break;
                case 'lt': conditionMet = currentValue < expected; break;
                case 'gt': conditionMet = currentValue > expected; break;
                case 'lte': conditionMet = currentValue <= expected; break;
                case 'gte': conditionMet = currentValue >= expected; break;
                case 'falsy': conditionMet = !currentValue; break;
                case 'truthy': conditionMet = Boolean(currentValue); break;
                case 'null':
                case 'nil': conditionMet = currentValue == null; break;
                case 'notnull':
                case 'notnil': conditionMet = currentValue != null; break;
                default: return 'INVALID_CONDITION';
            }

            if (!conditionMet) return 'CONDITION_NOT_MET';

            if (incrementBy !== 'nil') {
                current[lastField] = (Number(currentValue) || 0) + Number(incrementBy);
            } else if (newValue !== 'nil') {
                current[lastField] = normalizeLuaValue(newValue);
            }

            await this.set(key, JSON.stringify(obj));
            return 'SUCCESS';
        }

        throw new Error('Unsupported in-memory Redis eval script');
    }
}

function getRedisConfig() {
    const env = process.env.NODE_ENV || 'development';
    const baseConfig = {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || 6379, 10),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || 0, 10),
        keyPrefix: process.env.REDIS_PREFIX || '',
        enableAutoPipelining: true,
        retryStrategy: (times) => Math.min(times * 50, 2000),
        maxRetriesPerRequest: 3
    };

    if (process.env.REDIS_VERSION && parseInt(process.env.REDIS_VERSION.split('.')[0], 10) >= 6 && process.env.REDIS_USER) {
        baseConfig.username = process.env.REDIS_USER;
    }

    const envConfigs = {
        development: baseConfig,
        production: {
            ...baseConfig,
            maxRetriesPerRequest: 5,
            connectTimeout: 10000,
            tls: process.env.REDIS_TLS === 'true' ? {} : undefined
        },
        testing: {
            ...baseConfig,
            keyPrefix: `${process.env.REDIS_PREFIX || 'spillorama_bingo_game'}_test:`
        }
    };

    return envConfigs[env] || baseConfig;
}

const redisConfig = getRedisConfig();
const shouldUseRedis = Boolean(process.env.REDIS_HOST);

let redisClient;
if (shouldUseRedis) {
    console.log('Redis config (without sensitive data):', {
        ...redisConfig,
        password: redisConfig.password ? '******' : undefined
    });
    redisClient = new Redis(redisConfig);

    redisClient.on('connect', () => {
        console.log('Redis client connected successfully');
        console.log(`Connected to Redis at ${redisConfig.host}:${redisConfig.port} using prefix: ${redisConfig.keyPrefix}`);
    });

    redisClient.on('error', (err) => {
        console.error('Redis client error:', err);
    });

    redisClient.on('reconnecting', () => {
        console.log('Redis client reconnecting...');
    });

    redisClient.on('close', () => {
        console.log('Redis client connection closed');
    });

    if (process.env.REDIS_NOTIFY_KEYSPACE_EVENTS === 'true') {
        redisClient.config('SET', 'notify-keyspace-events', 'Ex');
        console.log('Redis keyspace events enabled');
    }
} else {
    console.log('REDIS_HOST is not configured. Using in-memory Redis fallback.');
    redisClient = new InMemoryRedisClient(redisConfig);
}

module.exports = redisClient;
