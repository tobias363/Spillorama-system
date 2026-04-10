'use strict';
const Redis = require('ioredis');
require('dotenv').config();

// Default Redis configuration based on environment
const getRedisConfig = () => {
    const env = process.env.NODE_ENV || 'development';
    
    // Base configuration from environment variables
    const baseConfig = {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || 6379),
        // Username is only supported in Redis 6+
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || 0),
        keyPrefix: process.env.REDIS_PREFIX || '',
        enableAutoPipelining: true, // Performance optimization
        retryStrategy: times => {
            // Exponential backoff with max delay of 2 seconds
            const delay = Math.min(times * 50, 2000);
            return delay;
        },
        maxRetriesPerRequest: 3
    };

    // Add username only if a compatible Redis version is being used and username is provided
    // This is handled by ioredis automatically, but we're not including it in the config by default
    // as it causes issues with Redis <6.0
    if (process.env.REDIS_VERSION && parseInt(process.env.REDIS_VERSION.split('.')[0]) >= 6 && process.env.REDIS_USER) {
        baseConfig.username = process.env.REDIS_USER;
    }

    // Environment-specific configurations
    const envConfigs = {
        development: baseConfig,
        production: {
            ...baseConfig,
            // For production, we might want stricter settings
            maxRetriesPerRequest: 5,
            connectTimeout: 10000,
            // Enable TLS if provided in production
            tls: process.env.REDIS_TLS === 'true' ? {} : undefined
        },
        testing: {
            ...baseConfig,
            keyPrefix: `${process.env.REDIS_PREFIX || 'spillorama_bingo_game'}_test:`
        }
    };

    return envConfigs[env] || baseConfig;
};

// Create Redis client
const redisConfig = getRedisConfig();
console.log('Redis config (without sensitive data):', {
    ...redisConfig,
    password: redisConfig.password ? '******' : undefined
});
const redisClient = new Redis(redisConfig);

// Log Redis connection events
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

// Enable key events if needed for pub/sub features
if (process.env.REDIS_NOTIFY_KEYSPACE_EVENTS === 'true') {
    redisClient.config('SET', 'notify-keyspace-events', 'Ex');
    console.log('Redis keyspace events enabled');
}

module.exports = redisClient;