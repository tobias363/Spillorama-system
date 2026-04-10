'use strict';
const Sys = require('../Boot/Sys');
const redis = require('../Config/Redis');

/**
 * Redis Helper
 * Provides reusable Redis operations for distributed game state management
 */
class RedisHelper {
    /**
     * Generate a namespaced Redis key
     * @param {string} type - The type of key (e.g., 'game', 'timer', 'lock', etc.)
     * @param {string} id - The unique identifier
     * @param {string} [subType] - Optional sub-type specification
     * @returns {string} - The namespaced Redis key
     */
    static generateKey(type, id, subType = '') {
        return `${type}:${id}${subType ? `:${subType}` : ''}`;
    }

    /**
     * Save data to Redis
     * @param {string} type - Key type (e.g., 'game', 'timer')
     * @param {string} id - Unique identifier
     * @param {Object|string|number} data - Data to store
     * @param {number} [expireSeconds] - Optional TTL in seconds
     * @param {string} [subType] - Optional sub-type for more specific keys
     * @returns {Promise<boolean>} - Success status
     */
    static async saveData(type, id, data, expireSeconds = null, subType = '') {
        try {
            const key = this.generateKey(type, id, subType);
            const serializedData = typeof data === 'object' ? JSON.stringify(data) : String(data);
            
            if (expireSeconds) {
                await redis.setex(key, expireSeconds, serializedData);
            } else {
                await redis.set(key, serializedData);
            }
            
            return true;
        } catch (error) {
            console.error(`Redis saveData error (${type}:${id}:${subType}):`, error);
            return false;
        }
    }

    /**
     * Get data from Redis
     * @param {string} type - Key type (e.g., 'game', 'timer')
     * @param {string} id - Unique identifier
     * @param {string} [subType] - Optional sub-type 
     * @returns {Promise<Object|string|null>} - The retrieved data or null if not found
     */
    static async getData(type, id, subType = '') {
        try {
            const key = this.generateKey(type, id, subType);
            const data = await redis.get(key);
            
            if (!data) return null;
            
            try {
                // Attempt to parse as JSON first
                return JSON.parse(data);
            } catch (e) {
                // If not valid JSON, return as is
                return data;
            }
        } catch (error) {
            console.error(`Redis getData error (${type}:${id}:${subType}):`, error);
            return null;
        }
    }

    /**
     * Delete data from Redis
     * @param {string} type - Key type
     * @param {string} id - Unique identifier
     * @param {string} [subType] - Optional sub-type
     * @returns {Promise<boolean>} - Success status
     */
    static async deleteData(type, id, subType = '') {
        try {
            const key = this.generateKey(type, id, subType);
            await redis.del(key);
            return true;
        } catch (error) {
            console.error(`Redis deleteData error (${type}:${id}:${subType}):`, error);
            return false;
        }
    }

    /**
     * Acquire a distributed lock
     * @param {string} resourceId - ID of resource to lock
     * @param {number} [ttlMs=5000] - Lock TTL in milliseconds
     * @returns {Promise<string|null>} - Lock token if successful, null otherwise
     */
    static async acquireLock(resourceId, ttlMs = 5000) {
        try {
            const lockKey = this.generateKey('lock', resourceId);
            const token = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
            
            // Use NX option to only set if key doesn't exist
            // PX sets expiry in milliseconds
            const result = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
            
            return result === 'OK' ? token : null;
        } catch (error) {
            console.error(`Redis acquireLock error (${resourceId}):`, error);
            return null;
        }
    }

    /**
     * Release a distributed lock
     * @param {string} resourceId - ID of resource to unlock
     * @param {string} token - Lock token to verify lock ownership
     * @returns {Promise<boolean>} - Success status
     */
    static async releaseLock(resourceId, token) {
        try {
            const lockKey = this.generateKey('lock', resourceId);
            
            // Use Lua script to ensure atomic release only if token matches
            const script = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
            `;
            
            const result = await redis.eval(script, 1, lockKey, token);
            return result === 1;
        } catch (error) {
            console.error(`Redis releaseLock error (${resourceId}):`, error);
            return false;
        }
    }

    /**
     * Set a timer in Redis
     * @param {string} timerId - Unique timer ID
     * @param {number} expiryMs - Time until expiry in milliseconds
     * @param {Object} [data={}] - Optional data to store with timer
     * @returns {Promise<boolean>} - Success status
     */
    static async setTimer(timerId, expiryMs, data = {}) {
        try {
            const expireAt = Date.now() + expiryMs;
            const timerData = {
                ...data,
                expireAt,
                createdAt: Date.now()
            };
            
            return await this.saveData('timer', timerId, timerData, Math.ceil(expiryMs / 1000) + 1);
        } catch (error) {
            console.error(`Redis setTimer error (${timerId}):`, error);
            return false;
        }
    }

    /**
     * Get timer data and check if expired
     * @param {string} timerId - Unique timer ID
     * @returns {Promise<Object|null>} - Timer data or null if expired/not found
     */
    static async getTimer(timerId) {
        try {
            const timerData = await this.getData('timer', timerId);
            
            if (!timerData) return null;
            
            // Check if timer is expired
            if (timerData.expireAt <= Date.now()) {
                // Auto-cleanup expired timer
                await this.deleteData('timer', timerId);
                return null;
            }
            
            return timerData;
        } catch (error) {
            console.error(`Redis getTimer error (${timerId}):`, error);
            return null;
        }
    }

    /**
     * Cancel a timer
     * @param {string} timerId - Unique timer ID
     * @returns {Promise<boolean>} - Success status
     */
    static async cancelTimer(timerId) {
        try {
            return await this.deleteData('timer', timerId);
        } catch (error) {
            console.error(`Redis cancelTimer error (${timerId}):`, error);
            return false;
        }
    }

    /**
     * Publish an event to a channel
     * @param {string} channel - Channel name
     * @param {Object|string} message - Message to publish
     * @returns {Promise<boolean>} - Success status
     */
    static async publish(channel, message) {
        try {
            const serializedMessage = typeof message === 'object' ? JSON.stringify(message) : message;
            await redis.publish(channel, serializedMessage);
            return true;
        } catch (error) {
            console.error(`Redis publish error (${channel}):`, error);
            return false;
        }
    }

    /**
     * Increment a counter atomically
     * @param {string} type - Counter type
     * @param {string} id - Counter ID
     * @param {number} [increment=1] - Increment amount
     * @param {number} [expireSeconds] - Optional TTL in seconds
     * @returns {Promise<number|null>} - New value or null on error
     */
    static async increment(type, id, increment = 1, expireSeconds = null) {
        try {
            const key = this.generateKey(type, id);
            let result;
            
            if (increment === 1) {
                result = await redis.incr(key);
            } else {
                result = await redis.incrby(key, increment);
            }
            
            if (expireSeconds && result === increment) {
                // Only set expiry if this was the first increment
                await redis.expire(key, expireSeconds);
            }
            
            return result;
        } catch (error) {
            console.error(`Redis increment error (${type}:${id}):`, error);
            return null;
        }
    }
    
    /**
     * Perform a health check on the Redis connection
     * @returns {Promise<boolean>} - True if Redis is responding
     */
    static async healthCheck() {
        try {
            // Simple ping-pong test
            const response = await redis.ping();
            return response === 'PONG';
        } catch (error) {
            console.error('Redis health check failed:', error);
            return false;
        }
    }
}

module.exports = RedisHelper; 