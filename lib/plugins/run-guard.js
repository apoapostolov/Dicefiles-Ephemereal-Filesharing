"use strict";

/** Renew active leases while a trusted run is alive; abort cooperative adapters
 * on lost ownership. A completed remote side effect cannot be rolled back. */
function guardPluginRun(ctx, leases) {
  const controller = new AbortController();
  let renewing = null;
  const renew = () => {
    if (renewing) {
      return renewing;
    }
    renewing = (async () => {
      try {
        if (typeof ctx.events?.renew === "function") {
          for (const lease of leases.filter(Boolean)) {
            if (!await ctx.events.renew(lease, 900)) {
              throw new Error("Bot run ownership expired. Check its last run before retrying.");
            }
          }
        }
      }
      catch (error) {
        controller.abort(error); throw error;
      }
      finally {
        renewing = null;
      }
    })();
    return renewing;
  };
  const timer = setInterval(() => {
    renew().catch(() => {});
  }, 60000); timer.unref?.();
  ctx.signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
  const mergeSignal = signal => signal ? AbortSignal.any([ctx.signal, signal]) : ctx.signal;
  if (typeof ctx.uploadFile === "function") {
    const upload = ctx.uploadFile;
    ctx.uploadFile = spec => {
      ctx.signal.throwIfAborted(); return upload({ ...spec, signal: mergeSignal(spec?.signal) });
    };
  }
  if (ctx.http) {
    const {http} = ctx; ctx.http = { ...http };
    for (const method of ["requestJson", "requestText", "requestBuffer"]) {
      if (typeof http[method] === "function") {
        ctx.http[method] = (url, options) => {
          ctx.signal.throwIfAborted(); return http[method](url, { ...options, signal: mergeSignal(options?.signal) });
        };
      }
    }
  }
  return {
    async assertOwned() {
      ctx.signal.throwIfAborted(); await renew(); ctx.signal.throwIfAborted();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { guardPluginRun };
