/**
 * Invoice Queue - Uses mock queue for development (Redis not required)
 */

// Force mock queue for development since Redis isn't installed
console.log('ℹ️  Using mock queue (development mode - Redis not required)');
const MockQueue = require('./mockQueue');
const queue = new MockQueue('invoice-notifications');

module.exports = queue;

