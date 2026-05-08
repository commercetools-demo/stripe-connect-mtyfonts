import {
  default as fastifyRequestContext,
  requestContext as frcRequestContext,
} from '@fastify/request-context';
import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import {
  Authentication,
  RequestContextData as SDKRequestContextData,
  getCartIdFromContext as sdkGetCartIdFromContext,
  getPaymentInterfaceFromContext as sdkGetPaymentInterfaceFromContext,
  getMerchantReturnUrlFromContext as sdkGetMerchantReturnUrlFromContext,
} from '@commercetools/connect-payments-sdk';

/**
 * Data stored under the 'request' key in the async-local-storage context.
 * (The shape is re-exported so global.d.ts can reference it.)
 */
export type ContextData = {
  correlationId?: string;
  requestId?: string;
  authentication?: Authentication;
  pathTemplate?: string;
  path?: string;
};

/**
 * Optional session data stored under the 'session' key.
 */
export type SessionContextData = {
  [key: string]: unknown;
};

/**
 * Fastify plugin – registers @fastify/request-context and populates the
 * correlationId / requestId / path fields from each incoming request.
 */
async function contextPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyRequestContext);

  fastify.addHook('onRequest', async (request) => {
    const contextData: ContextData = {
      correlationId:
        (request.headers['x-correlation-id'] as string | undefined) ?? request.id,
      requestId: request.id,
      path: request.url,
      pathTemplate: (request.routeOptions as { url?: string } | undefined)?.url ?? request.url,
    };
    frcRequestContext.set('request', contextData);
  });
}

export const requestContextPlugin = fastifyPlugin(contextPlugin);

/**
 * Returns the current request's context data.
 */
export function getRequestContext(): ContextData {
  return (frcRequestContext.get('request') as ContextData | undefined) ?? {};
}

/**
 * Merges the supplied partial context into the current request's context.
 */
export function updateRequestContext(context: Partial<ContextData>): void {
  const current = (frcRequestContext.get('request') as ContextData | undefined) ?? {};
  frcRequestContext.set('request', { ...current, ...context } as ContextData);
}

// ---------------------------------------------------------------------------
// Convenience wrappers around the SDK helpers
// ---------------------------------------------------------------------------

function toSDKContext(): SDKRequestContextData {
  const ctx = getRequestContext();
  return {
    correlationId: ctx.correlationId ?? '',
    requestId: ctx.requestId ?? '',
    authentication: ctx.authentication,
  };
}

export function getCartIdFromContext(): string {
  const cartId = sdkGetCartIdFromContext(toSDKContext());
  if (!cartId) {
    throw new Error('Cart ID not found in request context');
  }
  return cartId;
}

export function getPaymentInterfaceFromContext(): string {
  const paymentInterface = sdkGetPaymentInterfaceFromContext(toSDKContext());
  if (!paymentInterface) {
    throw new Error('Payment interface not found in request context');
  }
  return paymentInterface;
}

export function getMerchantReturnUrlFromContext(): string | undefined {
  return sdkGetMerchantReturnUrlFromContext(toSDKContext());
}
