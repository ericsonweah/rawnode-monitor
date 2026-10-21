// laboratorio entry point
// Copyright (c) 2025 Ericson S. Weah <ericson.weah@rawnodejs.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

//src/submodules/EventEmitter/index.js

import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);

import fs from "fs";
import path from "path";
import util from "util";
import https from "https";
import http from "http";
import { Transform, Readable } from "stream";
import { URL } from "url";
import { createWriteStream, createReadStream } from "fs";

/**
 *
 * @module EventEmitter
 * @kind class
 *
 * @extends EventEmitter
 * @requires EventEmitter
 * @classdesc EventEmitter class
 */
// moved import for fs// moved import for path// moved import for { Transform, Readable }// moved import for util// moved import for https// moved import for http// moved import for { URL }// moved import for { createWriteStream, createReadStream }

/**
 * Represents a EventEmitter class that extends the Transform class from the stream module.
 */
class EventEmitter extends require("events").EventEmitter {
    /**
     * Constructs a new instance of the EventEmitter class.
     *
     * @param {...Object} args - Additional objects containing options to be assigned to the EventEmitter class.
     */
    constructor(...args) {
        super();
        // Assign additional options to the EventEmitter class
        Object.assign(this, ...args);
        // Auto bind methods of the EventEmitter class
        this.autobind(EventEmitter);

        // Auto invoke methods of the EventEmitter class
        this.autoinvoker(EventEmitter);

        // Add methods from other classes if they do not already exist
        // Example: this.methodizer(...classList);

        // Set the maximum number of event listeners to infinity
        this.setMaxListeners(Infinity);

        this.middlewareStack = [];
        this.retryDelay = 500;
        this.maxRetries = 3;
        this.requestTimeout = 5000; // Default timeout for network requests
        this.cacheCondition = null; // Conditional caching rule
        this.eventThrottleTimers = new Map();
        this.requestQueue = [];
        this.logEvents = false;
        this.monitorProgress = false;
        this.rateLimitDelay = 0;
        this.globalMiddlewares = []; // Holds global middlewares
        this.routeMiddlewares = {}; // Holds route-specific middlewares
        this.context = {}; // Context object to pass through middleware
        this.errorRecoveryMiddlewares = []; // Error-handling middlewares
        this.errorLog = []; // Centralized error log
        this.eventHistory = new Map(); // Store event history
        this.channelHistory = new Map(); // Store channel history
    }

    message(data, message = "message") {
        // Perform some action...
        //console.log('Action performed with data:', data);

        // Emit an event
        this.emit(message, data);

        // Store the event in history
        this.storeEvent(message, data);
    }

    // Method to perform some action and emit an event
    performAction(data, actionPerformed = "actionPerformed") {
        // Perform some action...
        //console.log('Action performed with data:', data);

        // Emit an event
        this.emit(actionPerformed, data);

        // Store the event in history
        this.storeEvent(actionPerformed, data);
    }

    // Store emitted events in history
    storeEvent(eventName, data) {
        if (this.eventHistory && !this.eventHistory.has(eventName)) {
            this.eventHistory.set(eventName, []);
        }
        this.eventHistory.get(eventName).push(data);
    }

    // Replay stored events for a new listener
    on(eventName, listener) {
        super.on(eventName, listener); // Attach the listener

        // Replay stored events for this listener
        if (this.eventHistory && this.eventHistory.has(eventName)) {
            this.eventHistory.get(eventName).forEach((data) => {
                listener(data);
            });
        }
    }

    // Method to publish data to a channel // Method to publish data to a channel
    publish(channel, data) {
        //console.log(`Publishing to channel "${channel}":`, data);

        // Emit an event for the channel
        this.emit(channel, data);

        // Store the data in the channel's history
        this.storeChannelData(channel, data);
    }

    // Store published data in channel history
    storeChannelData(channel, data) {
        if (!this.channelHistory.has(channel)) {
            this.channelHistory.set(channel, []);
        }
        this.channelHistory.get(channel).push(data);
    }

    // Method to subscribe to a channel
    subscribe(channel, listener) {
        // Attach the listener to the channel
        this.on(channel, (data) => {
            // Pass both the channel name and data to the listener
            listener(channel, data);
        });

        // Replay stored data for this channel to the new listener
        if (this.channelHistory.has(channel)) {
            this.channelHistory.get(channel).forEach((data) => {
                listener(channel, data);
            });
        }
    }

    // Enhanced Error Logging
    logError(err) {
        const errorLogEntry = {
            message: err.message,
            stack: err.stack,
            timestamp: new Date().toISOString(),
        };
        this.errorLog.push(errorLogEntry);
        console.error(`[ERROR]: ${err.message}`);
    }

    /**
     * Add middleware function to intercept data during transformations.
     * @param {Function} middlewareFn - Middleware function to apply.
     */
    use(middlewareFn) {
        this.middlewareStack.push(middlewareFn);
    }
    /**
     * Registers a middleware for the global pipeline.
     * @param {Function} middleware - Global middleware function.
     */
    useGlobal(middleware) {
        this.globalMiddlewares.push(middleware);
    }

    /**
     * Registers route-specific middleware.
     * @param {String} path - The route path.
     * @param {...Function} middlewares - Middleware functions for the route.
     */
    useRoute(path, ...middlewares) {
        this.routeMiddlewares[path] = this.routeMiddlewares[path] || [];
        this.routeMiddlewares[path].push(...middlewares);
    }

    inspectMiddlewares() {
        return this.middlewareStack.map((fn, index) => ({
            index,
            name: fn.name || `Middleware ${index}`,
        }));
    }

    // Middleware Execution with Performance Tracking
    async executeMiddlewareQueueWithTiming(middlewares, context, done) {
        let index = -1;
        const timings = [];

        const next = async (error) => {
            if (error) return done(error);
            index++;
            if (index < middlewares.length) {
                const start = Date.now();
                try {
                    await middlewares[index](context.req, context.res, next);
                } catch (err) {
                    next(err);
                }
                const end = Date.now();
                timings.push({ middleware: middlewares[index].name || `Middleware ${index}`, duration: end - start });
            } else {
                console.log("Middleware timings:", timings);
                done();
            }
        };

        next();
    }

    async handleRequest(req, res, routePath, routeHandler) {
        const globalMiddlewares = this.globalMiddlewares || [];
        const routeSpecificMiddlewares = this.routeMiddlewares[routePath] || [];
        const allMiddlewares = [...globalMiddlewares, ...routeSpecificMiddlewares];
        const context = { req, res };

        this.executeMiddlewareQueueWithTiming(allMiddlewares, context, () => {
            routeHandler(req, res);
        });
    }

    // Async Initialization
    async init() {
        console.log("Initializing EventEmitter...");
        // Perform any setup operations here
    }

    // Stream Debugging Hooks
    enableDebugging() {
        this.on("data", (chunk) => console.log("Data chunk:", chunk));
        this.on("error", (err) => console.error("Stream error:", err));
        this.on("end", () => console.log("Stream ended."));
    }

    /**
     * Executes the middleware chain, passing modified req and res.
     * @param {Array} middlewares - The array of middleware functions.
     * @param {Object} context - The shared context, including req and res.
     * @param {Function} done - Callback to execute once the middleware chain finishes.
     */
    async executeMiddlewareQueue(middlewares, context, done) {
        let index = -1;

        const next = async (error) => {
            if (error) {
                return done(error); // Short-circuit on error
            }

            index++;
            if (index < middlewares.length) {
                try {
                    await middlewares[index](context.req, context.res, next); // Pass modified req and res
                } catch (err) {
                    next(err); // Pass the error to next middleware
                }
            } else {
                done(); // All middlewares executed
            }
        };

        next(); // Start the middleware execution
    }

    /**
     * Handle the request with route-specific middleware and global middleware.
     * @param {Object} req - Request object.
     * @param {Object} res - Response object.
     * @param {String} routePath - Path to match route middleware.
     * @param {Function} routeHandler - Final handler after middleware execution.
     */
    handleRequest(req, res, routePath, routeHandler) {
        const globalMiddlewares = this.globalMiddlewares || [];
        const routeSpecificMiddlewares = this.routeMiddlewares[routePath] || [];
        const allMiddlewares = [...globalMiddlewares, ...routeSpecificMiddlewares];

        const context = { req, res }; // Shared context between middlewares

        this.executeMiddlewareQueue(allMiddlewares, context, () => {
            // Once middleware is done, execute the route handler
            routeHandler(req, res);
        });
    }

    /**
     * Registers a middleware that will handle errors and retries.
     * @param {Function} middleware - Error recovery middleware.
     */
    useErrorRecovery(middleware) {
        this.errorRecoveryMiddlewares.push(middleware);
    }

    /**
     * Executes error recovery middleware in case of errors.
     * @param {Object} context - Contains the request, response, and error information.
     * @param {Function} done - Final callback after error handling completes.
     */
    async executeErrorRecovery(context, done) {
        let index = -1;
        const next = async (err) => {
            index++;
            if (index < this.errorRecoveryMiddlewares.length) {
                try {
                    await this.errorRecoveryMiddlewares[index](err, context.req, context.res, next);
                } catch (error) {
                    done(error); // Pass the error if recovery fails
                }
            } else {
                done(err); // All recovery middlewares exhausted
            }
        };
        next(context.error); // Start error recovery
    }

    /**
     * Process middleware for a specific route
     * @param {Object} req - Request object
     * @param {Object} res - Response object
     * @param {String} routePath - Path to match route middleware
     * @param {Function} routeHandler - Final handler after middleware
     */
    handleRequestWithMiddleware(req, res, routePath, routeHandler) {
        const globalMiddlewares = this.globalMiddlewares || [];
        const routeSpecificMiddlewares = this.routeMiddlewares[routePath] || [];
        const allMiddlewares = [...globalMiddlewares, ...routeSpecificMiddlewares];

        const context = { req, res }; // Context object for middleware
        this.executeMiddlewareQueue(allMiddlewares, context, () => {
            // Once middleware is done, execute the route handler
            routeHandler(req, res);
        });
    }

    /**
     * Execute middleware queue (global + route) with retry mechanism.
     * @param {Array} middlewares - Array of middleware functions.
     * @param {Object} context - Context object containing request, response, and retry info.
     * @param {Function} done - Final callback when all middlewares are done.
     * @param {Number} retryCount - The current retry attempt.
     * @param {Number} maxRetries - The maximum number of retry attempts.
     */
    async executeMiddlewareQueueWithRetry(middlewares, context, done, retryCount = 0, maxRetries = 3) {
        let index = -1;
        const next = async (error) => {
            if (error) {
                // Retry if max retries not reached
                if (retryCount < maxRetries) {
                    this.log("warn", `Retrying middleware... (${retryCount + 1}/${maxRetries})`);
                    return this.executeMiddlewareQueueWithRetry(middlewares, context, done, retryCount + 1, maxRetries);
                } else {
                    // Max retries reached, start error recovery
                    this.log("error", "Max retries reached. Starting error recovery...");
                    context.error = error; // Attach error to context
                    return this.executeErrorRecovery(context, done);
                }
            }
            index++;
            if (index < middlewares.length) {
                try {
                    await middlewares[index](context.req, context.res, next);
                } catch (err) {
                    next(err); // Pass the error to retry handler
                }
            } else {
                done(); // All middlewares finished successfully
            }
        };
        next();
    }
    /**
     * Middleware queue with error recovery.
     * @param {Array} middlewares - Array of middleware functions.
     * @param {Object} context - Context object containing request, response, and retry info.
     * @param {Function} done - Final callback when all middlewares are done.
     */
    async executeMiddlewareQueueWithRetry(middlewares, context, done) {
        this.executeMiddlewareQueue(middlewares, context, done); // Simplified without retry logic for this example
    }

    // Logging, autobinding, and autoinvoking (unchanged)
    log(type = "info", message = "") {
        const types = {
            info: "\x1b[36m%s\x1b[0m", // Cyan
            warn: "\x1b[33m%s\x1b[0m", // Yellow
            error: "\x1b[31m%s\x1b[0m", // Red
        };
        console.log(types[type] || types["info"], `[${type.toUpperCase()}] ${message}`);
    }
    /**
     * Register global error logger middleware
     */
    useErrorLogger(middleware) {
        this.errorRecoveryMiddlewares.push(middleware);
    }

    /**
     * Global error handler middleware to log errors
     */
    globalErrorHandler(err, req, res, next) {
        if (err) {
            const errorLogEntry = {
                message: err.message,
                stack: err.stack,
                time: new Date().toISOString(),
                url: req.url,
                method: req.method,
            };
            this.errorLog.push(errorLogEntry); // Save error log

            console.error(`[ERROR] ${err.message} at ${req.url}`);
            res.statusCode = 500;
            res.end("Internal Server Error");
        } else {
            next();
        }
    }

    /**
     * Executes the middleware chain with error recovery
     */
    async executeMiddlewareQueueWithErrorRecovery(middlewares, context, done) {
        let index = -1;

        const next = async (error) => {
            if (error) {
                this.executeErrorRecovery(context, done); // Error recovery flow
                return;
            }

            index++;
            if (index < middlewares.length) {
                try {
                    await middlewares[index](context.req, context.res, next); // Pass req/res with middleware chain
                } catch (err) {
                    next(err); // Pass error to next middleware
                }
            } else {
                done(); // All middlewares executed
            }
        };

        next(); // Start middleware execution
    }

    /**
     * Error recovery middleware execution
     */
    async executeErrorRecovery(context, done) {
        let index = -1;
        const next = async (err) => {
            index++;
            if (index < this.errorRecoveryMiddlewares.length) {
                try {
                    await this.errorRecoveryMiddlewares[index](err, context.req, context.res, next);
                } catch (error) {
                    done(error); // If recovery fails, pass it back
                }
            } else {
                done(err); // If no recovery middleware can handle it
            }
        };
        next(context.error); // Start error recovery with the captured error
    }

    /**
     * Fetches the error logs
     */
    getErrorLogs() {
        return this.errorLog;
    }

    // Logging, autobinding, and autoinvoking (unchanged)
    log(type = "info", message = "") {
        const types = {
            info: "\x1b[36m%s\x1b[0m", // Cyan
            warn: "\x1b[33m%s\x1b[0m", // Yellow
            error: "\x1b[31m%s\x1b[0m", // Red
        };
        console.log(types[type] || types["info"], `[${type.toUpperCase()}] ${message}`);
    }

    /**
     * Apply middleware functions to a given data chunk.
     * @param {any} chunk - The data chunk to process.
     * @returns {Promise<any>} - The transformed chunk.
     */
    async applyMiddleware(chunk) {
        for (let middlewareFn of this.middlewareStack) {
            chunk = await middlewareFn(chunk);
        }
        return chunk;
    }

    /**
     * Set custom error handling policy.
     * @param {Function} onError - Callback function for handling errors.
     */
    setErrorHandler(onError) {
        this.onError = onError;
    }

    /**
     * Retry request with configurable delay and attempts.
     * @param {Function} requestFn - The function to retry.
     * @param {number} attempts - The number of retry attempts.
     * @param {number} delay - Delay between retries.
     */
    async retryRequestWithDelay(requestFn, attempts = this.maxRetries, delay = this.retryDelay) {
        try {
            return await requestFn();
        } catch (error) {
            if (attempts <= 1) {
                if (this.onError) this.onError(error);
                throw error;
            }
            await new Promise((res) => setTimeout(res, delay));
            return this.retryRequestWithDelay(requestFn, attempts - 1, delay * 2);
        }
    }

    /**
     * Set custom timeout for network requests.
     * @param {number} timeout - Timeout in milliseconds.
     */
    setRequestTimeout(timeout) {
        this.requestTimeout = timeout;
    }

    /**
     * Perform a GET request with timeout.
     * @param {string} url - The URL to send the GET request to.
     * @param {Object} options - Additional options for the request.
     * @returns {Promise<any>} - The response data.
     */
    async getWithTimeout(url, options = {}) {
        return new Promise((resolve, reject) => {
            const request = https.get(url, options, (response) => {
                let data = [];
                response.on("data", (chunk) => data.push(chunk));
                response.on("end", () => resolve(Buffer.concat(data).toString()));
            });
            request.setTimeout(this.requestTimeout, () => {
                request.destroy();
                reject(new Error(`Request timed out after ${this.requestTimeout} ms`));
            });
            request.on("error", reject);
        });
    }

    /**
     * Define a caching rule for conditional caching.
     * @param {Function} conditionFn - A function that takes data and returns a boolean.
     */
    setCacheCondition(conditionFn) {
        this.cacheCondition = conditionFn;
    }

    /**
     * Cache response conditionally based on user-defined rule.
     * @param {string} url - The URL to cache.
     * @param {number} duration - Cache duration in milliseconds.
     */
    async conditionalCache(url, duration = 60000) {
        if (!this.cache) this.cache = new Map();
        if (this.cache.has(url)) {
            const { data, expiry } = this.cache.get(url);
            if (Date.now() < expiry) return data;
            this.cache.delete(url);
        }
        const responseData = await this.getWithTimeout(url);
        if (!this.cacheCondition || this.cacheCondition(responseData)) {
            this.cache.set(url, { data: responseData, expiry: Date.now() + duration });
        }
        return responseData;
    }

    /**
     * Throttle events to limit their frequency.
     * @param {string} event - Event name to throttle.
     * @param {number} delay - Throttle delay in milliseconds.
     * @param {Function} listener - The event listener function.
     */
    throttleEvent(event, delay, listener) {
        this.on(event, (...args) => {
            if (this.eventThrottleTimers.has(event)) return;
            listener(...args);
            this.eventThrottleTimers.set(
                event,
                setTimeout(() => {
                    this.eventThrottleTimers.delete(event);
                }, delay)
            );
        });
    }

    /**
     * Create a data processing pipeline with multiple transformations.
     * @param {...Function} transformFns - Transformation functions to apply in sequence.
     * @returns {Function} - A composed transformation function.
     */
    createPipeline(...transformFns) {
        return async (data) => {
            let transformedData = data;
            for (let transformFn of transformFns) {
                transformedData = await transformFn(transformedData);
            }
            return transformedData;
        };
    }

    /**
     * Batch process chunks of data for optimized transformation.
     * @param {Array} dataBatch - An array of data to process in batches.
     * @param {Function} transformFn - The transformation function to apply.
     * @param {number} batchSize - Number of items per batch.
     */
    async processInBatches(dataBatch, transformFn, batchSize = 10) {
        for (let i = 0; i < dataBatch.length; i += batchSize) {
            const batch = dataBatch.slice(i, i + batchSize);
            await transformFn(batch);
        }
    }

    /**
     * Log events with detailed information.
     * @param {string} eventType - The type of event to log.
     * @param {any} data - Data associated with the event.
     */
    logEvent(eventType, data) {
        if (this.logEvents) {
            console.log(`[${new Date().toISOString()}] Event: ${eventType}`, data);
            this.emit(eventType, data);
        }
    }

    /**
     * Caches HTTP response data for specified URLs.
     * @param {string} url - The URL to cache.
     * @param {number} duration - Cache duration in milliseconds.
     */
    async cacheResponse(url, duration = 60000) {
        if (!this.cache) this.cache = new Map();
        if (this.cache.has(url)) {
            const { data, expiry } = this.cache.get(url);
            if (Date.now() < expiry) return data;
            this.cache.delete(url);
        }
        const responseData = await this.get(url);
        this.cache.set(url, { data: responseData, expiry: Date.now() + duration });
        return responseData;
    }

    /**
     * Perform a GET request with retry and rate limiting.
     * @param {string} url - The URL to send the GET request to.
     */
    async getWithRetryAndRateLimit(url) {
        this.queueRequest(() => {
            this.retryRequest(() => this.get(url))
                .then((response) => {
                    this.emit("getWithRetryAndRateLimit", response);
                })
                .catch((error) => {
                    this.emit("getWithRetryAndRateLimit-error", error);
                });
        });
    }

    // ---- New Features ----

    /**
     * Enable event logging for specific events.
     * @param {boolean} enable - Set to true to enable logging.
     */
    enableEventLogging(enable = true) {
        this.logEvents = enable;
    }

    /**
     * Enable or disable real-time monitoring for transformation progress.
     * @param {boolean} enable - Set to true to enable monitoring.
     */
    enableProgressMonitoring(enable = true) {
        this.monitorProgress = enable;
    }

    /**
     * Track transformation progress and invoke the provided callback on each chunk.
     * @param {any} chunk - The data chunk to process.
     * @param {Function} callback - Callback function to invoke with progress data.
     */
    trackProgress(chunk, callback) {
        if (this.monitorProgress && typeof callback === "function") {
            callback(chunk);
        }
    }

    /**
     * Apply schema validation on incoming data before transformation.
     * @param {Function} validationFn - Function to validate incoming data.
     */
    validateSchema(validationFn) {
        this.schemaValidator = validationFn;
    }

    /**
     * Transform data with schema validation and middleware.
     * @param {any} chunk - Data chunk to transform.
     * @returns {any} - Validated and transformed data.
     */
    async validateAndTransform(chunk) {
        if (this.schemaValidator && !this.schemaValidator(chunk)) {
            throw new Error("Data validation failed");
        }
        return this.applyMiddleware(chunk);
    }

    /**
     * Enable stream compression (gzip).
     * @param {boolean} enable - Enable or disable compression.
     */
    enableCompression(enable = true) {
        if (enable) this.gzipStream = zlib.createGzip();
    }

    /**
     * Compress data using gzip compression.
     * @param {Buffer} data - The data to compress.
     * @returns {Promise<Buffer>} - The compressed data.
     */
    async compressData(data) {
        if (!this.gzipStream) return data;
        return new Promise((resolve, reject) => {
            this.gzipStream.write(data, (err, compressed) => {
                if (err) reject(err);
                resolve(compressed);
            });
        });
    }

    /**
     * Decompress gzip data.
     * @param {Buffer} data - The data to decompress.
     * @returns {Promise<Buffer>} - The decompressed data.
     */
    async decompressData(data) {
        if (!this.gzipStream) return data;
        return new Promise((resolve, reject) => {
            zlib.gunzip(data, (err, decompressed) => {
                if (err) reject(err);
                resolve(decompressed);
            });
        });
    }

    /**
     * Apply rate limiting to HTTP requests.
     * @param {number} delay - Delay in milliseconds between requests.
     */
    setRateLimit(delay) {
        this.rateLimitDelay = delay;
    }

    /**
     * Make a rate-limited HTTP request.
     * @param {Function} requestFn - The request function to rate-limit.
     * @returns {Promise<any>} - The result of the HTTP request.
     */
    async rateLimitedRequest(requestFn) {
        if (this.rateLimitDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.rateLimitDelay));
        }
        return requestFn();
    }

    /**
     * Encrypt data using AES-256 encryption.
     * @param {string} data - The data to encrypt.
     * @param {string} key - The encryption key.
     * @returns {Buffer} - The encrypted data.
     */
    encryptData(data, key) {
        const cipher = crypto.createCipher("aes-256-cbc", key);
        let encrypted = cipher.update(data, "utf8", "hex");
        encrypted += cipher.final("hex");
        return encrypted;
    }

    /**
     * Decrypt data encrypted with AES-256 encryption.
     * @param {string} encryptedData - The encrypted data.
     * @param {string} key - The decryption key.
     * @returns {string} - The decrypted data.
     */
    decryptData(encryptedData, key) {
        const decipher = crypto.createDecipher("aes-256-cbc", key);
        let decrypted = decipher.update(encryptedData, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }

    /**
     * Apply exponential backoff strategy for failed requests.
     * @param {Function} requestFn - The request function to retry.
     * @param {number} maxAttempts - Maximum retry attempts.
     * @returns {Promise<any>} - The result of the HTTP request.
     */
    async exponentialBackoff(requestFn, maxAttempts = this.maxRetries) {
        let delay = this.retryDelay;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                if (attempt === maxAttempts) throw error;
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
    }

    /**
     * Joins the specified path with the EventEmitter path.
     *
     * @param {string} [path=''] - The path to be joined.
     * @param {string} [EventEmitter=process.cwd()] - The EventEmitter path.
     * @returns {string} - The joined path.
     */
    path(path = "", EventEmitter = process.cwd()) {
        // Use the 'path' module's join function to join the path with the EventEmitter path
        return require("path").join(EventEmitter, path);
    }

    /**
     * Creates a writable stream for the specified path.
     *
     * @param {string} [path='./'] - The path for the writable stream.
     * @param {object} [options={ objectMode: true, encoding: 'utf-8', autoDestroy: true }] - The options for the writable stream.
     * @returns {WritableStream} - The writable stream.
     */
    writable(path = this.path("./"), options = { objectMode: true, encoding: "utf-8", autoDestroy: true }) {
        // Use the 'createWriteStream' function to create a writable stream with the specified path and options
        return createWriteStream(path, options);
    }

    /**
     * Creates a readable stream for the specified path.
     *
     * @param {string} [path='.'] - The path for the readable stream.
     * @param {object} [options={ objectMode: true, encoding: 'utf-8', autoDestroy: true }] - The options for the readable stream.
     * @returns {ReadableStream} - The readable stream.
     */
    readable(path = this.path("."), options = { objectMode: true, encoding: "utf-8", autoDestroy: true }) {
        // Use the 'createReadStream' function to create a readable stream with the specified path and options
        return createReadStream(path, options);
    }

    /**
     * Retrieves data from an iterable and returns a readable stream.
     *
     * @param {object|[]} [iterable={}] - The iterable object or array containing the data.
     * @param {object} [options={ objectMode: true, encoding: 'utf-8', autoDestroy: true }] - The options for the readable stream.
     * @returns {ReadableStream} - The readable stream.
     */
    getFromIterable(iterable = {} | [], options = { objectMode: true, encoding: "utf-8", autoDestroy: true }) {
        // Convert the iterable to a JSON string and use the 'EventEmitter.from' method to create a readable stream
        return Readable.from(JSON.stringify(iterable), options);
    }

    /**
     * A class method that returns a function for making HTTP GET requests.
     *
     * @param {Function} resolve - The function to call when the request is successful.
     * @param {Function} reject - The function to call when the request encounters an error.
     * @returns {Function} - The function for making HTTP GET requests.
     */
    fns(resolve = () => {}, reject = () => {}) {
        /**
         * The function for making HTTP GET requests.
         *
         * @param {string} protocal - The protocol to use for the request (e.g., 'https').
         * @param {string} url - The URL to make the request to.
         * @param {Function} fn - The function to call after the request is completed.
         * @returns {Function} - The function for setting options and handling the response.
         */
        return (protocal = "https", url, fn = () => {}) => {
            /**
             * The function for setting options and handling the response.
             *
             * @param {Object} options - The options for the request.
             * @param {Array} data - The array to store response chunks.
             */
            return (options = {}, data = []) => {
                protocal["get"](url, options, (response) => {
                    response.on("data", (chunk) => {
                        data.push(chunk);
                    });
                    response.on("error", (error) => {
                        reject(error.message || error);
                        fn(error.message || error, null, null);
                        this.emit("get-error", error);
                    });
                    response.on("end", () => {
                        const responseData = JSON.parse(Buffer.concat(data).toString());
                        this.emit("get", responseData);
                        resolve(responseData);
                        fn(null, responseData, data);
                    });
                });
            };
        };
    }

    /**
     * Performs a GET request to the specified URL and retrieves the response data.
     *
     * @param {string} [url='https://jsonplaceholder.typicode.com/comments'] - The URL to perform the GET request.
     * @param {function} [fn=() => {}] - The callback function to be executed during the GET request.
     * @param {object} [options={}] - The options for the GET request.
     * @param {Array} [data=[]] - The array to store the response data chunks.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */

    async get(items = "users", url = "https://dummyjson.com", fn = () => {}, options = {}, data = []) {
        return new Promise((resolve, reject) => {
            https.get(`${url}/${items}`, options, (response) => {
                response.on("data", (chunk) => {
                    data.push(chunk);
                });
                response.on("error", (error) => {
                    reject(error.message || error);
                    fn(error.message || error, null, null);
                    this.emit("get-error", error);
                });
                response.on("end", () => {
                    const responseData = JSON.parse(Buffer.concat(data).toString());
                    this.emit("get", responseData);
                    resolve(responseData);
                    fn(null, responseData, data);
                });
            });
        });
    }

    /**
     * Generates the options object for making HTTP requests.
     *
     * @param {string} url - The URL for the request.
     * @param {string} method - The HTTP method for the request (default: 'POST').
     * @param {number} port - The port for the request (default: 443).
     * @param {Object} headers - The headers for the request (default: {'Content-Type': 'application/json'}).
     * @returns {Object} - The options object.
     */
    options(url, method = "POST", port = 443, headers = { "Content-Type": "application/json" }) {
        const options = new URL(url);
        options.port = port;
        options.method = method;
        options.headers = headers;
        return options;
    }

    /**
     * Performs an API request to the specified URL using the provided options.
     *
     * @param {string} url - The URL to which the API request will be sent.
     * @param {object} options - The options for the API request.
     * @param {function} [fn=() => {}] - The callback function to be executed during the API request.
     * @param {Array} [data=[]] - The array to store the response data chunks.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */
    async apiRequest(items = "users", url = "https://dummyjson.com", options, fn = () => {}, data = []) {
        return new Promise((resolve, reject) => {
            https.request(url, options, (response) => {
                response.on("data", (chunk) => {
                    data.push(chunk);
                });
                response.on("error", (error) => {
                    this.emit("apiRequest-error", error.message || error);
                    reject(error.message || error);
                    fn(error.message || error, null, null);
                });
                response.on("end", () => {
                    const responseData = JSON.parse(Buffer.concat(data).toString());
                    this.emit("apiRequest", responseData);
                    resolve(responseData);
                    fn(null, responseData, data);
                });
            });
        });
    }

    /**
     * Sends a POST request to the specified URL with the provided data.
     *
     * @param {string} url - The URL to which the POST request will be sent.
     * @param {object|string} data - The data to be included in the request body.
     * @param {function} [fn=() => {}] - The callback function to be executed during the request.
     * @param {object} [headers={'Content-Type': 'application/json'}] - The headers for the request.
     * @param {string} [datum=''] - The accumulated response data.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */
    async post(url = "", data = {}, fn = () => {}, headers = { "Content-Type": "application/json" }, datum = "") {
        return new Promise((resolve, reject) => {
            const options = new URL(url);
            options.port = 443;
            options.method = "POST";
            options.headers = headers;

            const req = https.request(options, (response) => {
                response.on("data", (chunk) => {
                    datum += chunk;
                });
                response.on("end", () => {
                    const responseData = JSON.parse(datum);
                    this.emit("post", responseData);
                    resolve(responseData);
                    fn(null, responseData, datum);
                });
                response.on("error", (error) => {
                    this.emit("error", error.message || error);
                    reject(error.message || error);
                    fn(error.message || error, null, null);
                });
            });
            req.write(JSON.stringify(data));
            req.end();
        });
    }

    /**
     * Sends a PUT request to the specified URL with the provided data.
     *
     * @param {string} url - The URL to which the PUT request will be sent.
     * @param {object|string} data - The data to be included in the request body.
     * @param {function} [fn=() => {}] - The callback function to be executed during the request.
     * @param {object} [headers={'Content-Type': 'application/json'}] - The headers for the request.
     * @param {string} [datum=''] - The accumulated response data.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */

    async put(url = "", data = {}, fn = () => {}, headers = { "Content-Type": "application/json" }, datum = "") {
        return new Promise((resolve, reject) => {
            const options = new URL(url);
            options.port = 443;
            options.method = "PUT";
            options.headers = headers;

            const req = https.request(options, (response) => {
                response.on("data", (chunk) => {
                    datum += chunk;
                });
                response.on("end", () => {
                    const responseData = JSON.parse(datum);
                    this.emit("put", responseData);
                    resolve(responseData);
                    fn(null, responseData, datum);
                });
                response.on("error", (error) => {
                    this.emit("error", error.message || error);
                    reject(error.message || error);
                    fn(error.message || error, null, null);
                });
            });

            req.write(JSON.stringify(data));
            req.end();
        });
    }

    /**
     * Sends a DELETE request to the specified URL.
     *
     * @param {string} url - The URL to which the DELETE request will be sent.
     * @param {function} [fn=() => {}] - The callback function to be executed during the request.
     * @param {object} [headers={'Content-Type': 'application/json'}] - The headers for the request.
     * @param {string} [datum=''] - The accumulated response data.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */
    async delete(url = "", fn = () => {}, headers = { "Content-Type": "application/json" }, datum = "") {
        return new Promise((resolve, reject) => {
            const options = new URL(url);
            options.port = 443;
            options.method = "DELETE";
            options.headers = headers;

            const req = https.request(options, (response) => {
                response.on("data", (chunk) => {
                    datum += chunk;
                });
                response.on("end", () => {
                    const responseData = JSON.parse(datum);
                    this.emit("delete", responseData);
                    resolve(responseData);
                    fn(null, responseData, datum);
                });
                response.on("error", (error) => {
                    this.emit("error", error.message || error);
                    reject(error.message || error);
                    fn(error.message || error, error, null, null);
                });
            });

            req.write(datum);
            req.end();
        });
    }

    /**
     * Sends a GET request to the specified URL.
     *
     * @param {string} url - The URL to which the GET request will be sent.
     * @param {function} [fn=() => {}] - The callback function to be executed during the request.
     * @param {Array} [data=[]] - The accumulated response data.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */
    async GET(url, fn = () => {}, data = []) {
        return new Promise((resolve, reject) => {
            const options = new URL(url);
            options.method = "GET";

            http.get(url, options, (response) => {
                response.on("data", (chunk) => {
                    data.push(chunk);
                });
                response.on("error", (error) => {
                    this.emit("GET-error", error.message || error);
                    reject(error.message || error);
                    fn(error.message || error, null, null);
                });
                response.on("end", () => {
                    const responseData = JSON.parse(Buffer.concat(data).toString());
                    this.emit("GET", responseData);
                    resolve(responseData);
                    fn(null, responseData, data);
                });
            });
        });
    }

    /**
     * Sends an API request using the specified URL and options.
     *
     * @param {string} url - The URL to which the API request will be sent.
     * @param {object} options - The options object for the request.
     * @param {function} [fn=() => {}] - The callback function to be executed during the request.
     * @param {Array} [data=[]] - The accumulated response data.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */
    async apiREQUEST(url, options, fn = () => {}, data = []) {
        return new Promise((resolve, reject) => {
            http.request(url, options, (response) => {
                response.on("data", (chunk) => {
                    data.push(chunk);
                });
                response.on("error", (error) => {
                    this.emit("apiREQUEST-error", error.message || error);
                    reject(error.message || error);
                    fn(error.message || error, null, null);
                });
                response.on("end", () => {
                    const responseData = JSON.parse(Buffer.concat(data).toString());
                    this.emit("apiREQUEST", responseData);
                    resolve(responseData);
                    fn(null, responseData, data);
                });
            });
        });
    }

    /**
     * Sends a POST request to the specified URL with the provided data and options.
     *
     * @param {string} url - The URL to which the POST request will be sent.
     * @param {object} data - The data to be sent with the POST request.
     * @param {function} [fn=() => {}] - The callback function to be executed during the request.
     * @param {object} [headers={'Content-Type': 'application/json'}] - The headers for the request.
     * @param {string} [datum=[]] - The accumulated response data.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */
    async POST(url = "", data = {}, fn = () => {}, headers = { "Content-Type": "application/json" }, datum = []) {
        return new Promise((resolve, reject) => {
            const options = new URL(url);
            // options.port = 3000 || port;
            options.method = "POST";
            options.headers = headers || {};

            const req = http.request(options, (response) => {
                response.on("data", (chunk) => {
                    datum.push(chunk);
                });
                response.on("end", () => {
                    const responseData = JSON.parse(datum);
                    this.emit("POST", responseData);
                    resolve(responseData);
                    fn(null, responseData, datum);
                });
                response.on("error", (error) => {
                    this.emit("error", error.message || error);
                    reject(error.message || error);
                    fn(error.message || error, null, null);
                });
            });
            req.write(JSON.stringify(data));
            req.end();
        });
    }

    /**
     * Sends a PUT request to the specified URL with the provided data and options.
     *
     * @param {string} url - The URL to which the PUT request will be sent.
     * @param {object} data - The data to be sent with the PUT request.
     * @param {function} [fn=() => {}] - The callback function to be executed during the request.
     * @param {object} [headers={'Content-Type': 'application/json'}] - The headers for the request.
     * @param {string} [datum=''] - The accumulated response data.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */
    async PUT(url = "", data = {}, fn = () => {}, headers = { "Content-Type": "application/json" }, datum = []) {
        return new Promise((resolve, reject) => {
            const options = new URL(url);
            options.method = "PUT";
            options.headers = headers;

            const req = http.request(options, (response) => {
                response.on("data", (chunk) => {
                    datum.push(chunk);
                });
                response.on("end", () => {
                    const responseData = JSON.parse(datum);
                    this.emit("PUT", responseData);
                    resolve(responseData);
                    fn(null, responseData, datum);
                });
                response.on("error", (error) => {
                    this.emit("error", error.message || error);
                    reject(error.message || error);
                    fn(error.message || error, null, null);
                });
            });
            req.write(JSON.stringify(data));
            req.end();
        });
    }

    /**
     * Sends a DELETE request to the specified URL with the provided options.
     *
     * @param {string} url - The URL to which the DELETE request will be sent.
     * @param {function} [fn=() => {}] - The callback function to be executed during the request.
     * @param {object} [headers={'Content-Type': 'application/json'}] - The headers for the request.
     * @param {string} [datum=''] - The accumulated response data.
     * @returns {Promise<object>} - A promise that resolves with the parsed response data.
     */
    async DELETE(url = "", fn = () => {}, headers = { "Content-Type": "application/json" }, datum = "") {
        return new Promise((resolve, reject) => {
            const options = new URL(url);
            options.method = "DELETE";
            options.headers = headers;

            const req = http.request(options, (response) => {
                response.on("data", (chunk) => {
                    datum += chunk;
                });
                response.on("end", () => {
                    const responseData = JSON.parse(datum);
                    this.emit("DELETE", responseData);
                    resolve(responseData);
                    fn(null, responseData, datum);
                });
                response.on("error", (error) => {
                    this.emit("error", error.message || error);
                    reject(error.message || error);
                    fn(error.message || error, null, null);
                });
            });
            req.write(datum);
            req.end();
        });
    }

    /**
     * Removes duplicate listeners for the specified event.
     *
     * @param {string} event - The event for which duplicate listeners will be removed.
     */
    removeDuplicateListeners(event) {
        if (this.rawListeners(event).length > 1) {
            for (let i = 1; i < this.rawListeners(event).length; i++) {
                this.removeListener(event, this.rawListeners(event)[i]);
            }
        }
    }
    searchFileInDirectory(directoryPath, targetFileName) {
        try {
            const files = fs.readdirSync(directoryPath);
            for (const file of files) {
                const filePath = path.join(directoryPath, file);
                const stats = fs.statSync(filePath);

                if (stats.isDirectory()) {
                    const foundFilePath = searchFileInDirectory(filePath, targetFileName);
                    if (foundFilePath) {
                        return foundFilePath; // Return early if file is found
                    }
                } else if (file === targetFileName) {
                    return filePath; // Return the path of the found file
                }
            }
            return null; // File not found in this directory
        } catch (error) {
            console.error("Error searching for file:", error);
            return null;
        }
    }

    recursivelyCreateFile(filePath) {
        try {
            // Check if the file already exists
            if (fs.existsSync(filePath)) {
                console.log(`File '${filePath}' already exists.`);
                return;
            }

            // Extract the directory path from the file path
            const directoryPath = path.dirname(filePath);

            // Recursively create the parent directories if they don't exist
            recursivelyCreateDirectory(directoryPath);

            // Create the file
            fs.writeFileSync(filePath, "");

            console.log(`File '${filePath}' created.`);
        } catch (error) {
            console.error("Error creating file:", error);
        }
    }

    recursivelyCreateDirectory(directoryPath) {
        if (!fs.existsSync(directoryPath)) {
            recursivelyCreateDirectory(path.dirname(directoryPath));
            fs.mkdirSync(directoryPath);
        }
    }

    searchFileInDirectoryStream(directoryPath, targetFileName, callback) {
        const fileStream = new Transform({
            transform(chunk, encoding, done) {
                const fileNames = chunk.toString().split("\n");
                for (const fileName of fileNames) {
                    if (fileName === targetFileName) {
                        this.push(path.join(directoryPath, fileName));
                    }
                }
                done();
            },
        });

        const dirStream = fs.createReadStream(path.join(directoryPath, "files.txt"));

        dirStream.on("error", (error) => {
            console.error("Error reading directory:", error);
            callback(null);
        });

        fileStream.on("data", (filePath) => {
            callback(filePath);
        });

        fileStream.on("end", () => {
            callback(null); // File not found
        });

        dirStream.pipe(fileStream);
    }

    recursivelyCreateFileStream(filePath, callback) {
        const directoryPath = path.dirname(filePath);

        createDirectoryRecursiveStream(directoryPath, () => {
            const writable = fs.createWriteStream(filePath);

            writable.on("finish", () => {
                callback();
            });

            const readable = Readable.from([""]); // Creating an empty readable stream

            readable.pipe(writable);
        });
    }

    createDirectoryRecursiveStream(directoryPath, callback) {
        if (!fs.existsSync(directoryPath)) {
            createDirectoryRecursiveStream(path.dirname(directoryPath), () => {
                fs.mkdirSync(directoryPath);
                callback();
            });
        } else {
            callback();
        }
    }

    /**
     * Autobinds class methods to the instance of the class.
     *
     * @param {Object} className - The class whose methods will be autobound.
     */
    autobinder(className = {}) {
        for (let method of Object.getOwnPropertyNames(className.prototype)) {
            if (typeof this[method] === "function" && method !== "constructor") {
                this[method] = this[method].bind(this);
            }
        }
    }

    /**
     * Autobinds the autobinder method to the current instance and invokes it with the specified class.
     *
     * @param {Object} className - The class whose methods will be autobound.
     */
    autobind(className = {}) {
        this.autobinder = this.autobinder.bind(this);
        this.autobinder(className);
    }

    /**
     * Methodizes the methods from the specified class(es) by binding them to the current instance.
     *
     * @param {...Object} classNamesList - The classes whose methods will be methodized.
     */
    methodizer(...classNamesList) {
        if (classNamesList.length === 0) return;
        for (let className of classNamesList) {
            for (let method of Object.getOwnPropertyNames(className.prototype)) {
                if (this[method] === undefined || !this[method]) {
                    if (typeof className.prototype[method] === "function") {
                        this[method] = className.prototype[method];
                        // Auto bind each method from the className class to this
                        this[method] = this[method].bind(this);
                    }
                }
            }
        }
    }

    /**
     * Methodizes the methods from the specified objects by binding them to the current instance.
     *
     * @param {...Object} objectWithMethodList - The objects containing methods to be methodized.
     */
    methodizeProperty(...objectWithMethodList) {
        if (objectWithMethodList.length === 0) return;
        objectWithMethodList.forEach((objectWithMethod) => {
            Object.keys(objectWithMethod).forEach((method) => {
                if (!this[method] || this[method] == undefined) {
                    this[method] = objectWithMethod[method];
                    if (typeof this[method] === "function") {
                        this[method] = this[method].bind(this);
                    }
                }
            });
        });
    }

    /**
     * Methodizes the prototype methods from the specified class names by binding them to the current instance.
     *
     * @param {...Function} classNamesList - The class names whose prototype methods to methodize.
     */

    methodizePrototype(...classNamesList) {
        if (classNamesList.length === 0) return;
        for (let className of classNamesList) {
            for (let method of Object.getOwnPropertyNames(className.prototype)) {
                if (this[method] === undefined || !this[method]) {
                    if (typeof className.prototype[method] === "function") {
                        this[method] = className.prototype[method];
                        if (typeof this[method] === "function") {
                            this[method] = this[method].bind(this);
                        }
                    }
                }
            }
        }
    }

    /**
     * Automatically invokes methods from the specified class name on the current instance.
     *
     * @param {Function} className - The class name whose methods to automatically invoke.
     */
    autoinvoker(className = {}) {
        for (let method of Object.getOwnPropertyNames(className.prototype)) {
            this.autoinvoked().forEach((name) => {
                if (method === name) {
                    this[method]();
                }
            });
        }
    }

    /**
     * Returns an array of method names that should be automatically invoked by the `autoinvoker` method.
     * Modify this method to specify the method names to be autoinvoked.
     *
     * @returns {Array} - An array of method names.
     */

    autoinvoked() {
        return [""];
    }
}

export default EventEmitter;
