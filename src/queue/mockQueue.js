/**
 * Mock Queue for development without Redis
 * Processes jobs immediately in-memory
 */

class MockQueue {
  constructor(name) {
    this.name = name;
    this.processor = null;
    console.log(`Mock queue "${name}" initialized (no Redis required)`);
  }

  async add(jobName, data, options = {}) {
    console.log(`[MockQueue] Job "${jobName}" added to queue`);

    // If processor is registered, execute immediately
    if (this.processor) {
      try {
        const job = {
          id: Date.now().toString(),
          data,
          progress: (percent) => console.log(`[MockQueue] Progress: ${percent}%`),
        };

        console.log(`[MockQueue] Processing job immediately...`);
        const result = await this.processor(job);
        console.log(`[MockQueue] Job completed successfully`);
        return {
          id: job.id,
          data,
          result,
        };
      } catch (error) {
        console.error(`[MockQueue] Job failed:`, error.message);
        throw error;
      }
    } else {
      console.log(`[MockQueue] No processor registered, job queued`);
      return {
        id: Date.now().toString(),
        data,
      };
    }
  }

  process(jobName, concurrency, processorFn) {
    console.log(`[MockQueue] Processor registered for "${jobName}"`);
    this.processor = processorFn;
  }

  async close() {
    console.log(`[MockQueue] Queue "${this.name}" closed`);
  }
}

module.exports = MockQueue;
