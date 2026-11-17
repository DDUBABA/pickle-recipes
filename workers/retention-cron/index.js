import {runRetention} from '../../lib/retention.js';

export default {
  async scheduled(controller,env){
    // Await so Cloudflare records a failed invocation if D1 cleanup fails.
    await runRetention(env.DB,{now:controller.scheduledTime??Date.now()});
  }
};
