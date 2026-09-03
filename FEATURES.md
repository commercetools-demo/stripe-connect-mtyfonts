# Features

Code-derived inventory of what this repo implements. Bullets and key file paths —
the mechanism lives in `docs/how-it-works.md`, the walkthrough in `docs/demo-script.md`.

_Last generated: 2026-09-02 by feature-doc._

This repository is a commercetools [Connect](https://docs.commercetools.com/connect) payment
integration for Stripe (`connect.yaml` deploys an `enabler` static-assets app and a `processor`
service). It is the official commercetools Stripe Connect payment integration template
(`processor/package.json` name: `payment-integration-template`) deployed under the customer name
`mtyfonts` — there is no `mtyfonts`-specific code anywhere in the tree (`grep -ri mtyfonts`
across the repo matches nothing but the repo name itself), and the two commits in `git log`
are a dependency-vulnerability patch and a missing-module fix, not customer customization. So
this is the connector as commercetools ships it, not a fork of one of the tracked demo starters;
bullets below carry no per-bullet provenance tag for that reason.

## Payment Processing (Processor — Stripe Payment Intents)

- Creates a Stripe PaymentIntent for the active checkout session cart via `GET/POST /payments`,
  with the `POST` variant additionally accepting per-payment-method `paymentMethodOptions` (e.g.
  Boleto/PIX expiration) (`processor/src/routes/stripe-payment.route.ts`,
  `processor/src/services/stripe-payment.service.ts`)
- Confirms a Stripe PaymentIntent back into the commercetools payment via
  `POST /confirmPayments/:id`, translating the result into `APPROVED`/`REJECTED`
  (`processor/src/routes/stripe-payment.route.ts`)
- Modifies an existing payment (capture, cancel, refund) through the commercetools payment
  Update Actions API at `POST /payment-intents/:id`, gated by `manage_checkout_payment_intents`
  scope (`processor/src/routes/operation.route.ts`)
- Serves the Stripe Payment Element / Express Checkout initialization payload — publishable key,
  appearance, layout, capture method, `paymentMode` — via `GET /config-element/:payment`
  (`processor/src/routes/stripe-payment.route.ts`)
- Supports manual and automatic (and `automatic_async`) capture modes via
  `STRIPE_CAPTURE_METHOD` (`processor/src/config/config.ts`)
- Structured error handling for `requires_action` and `payment_failed` PaymentIntent statuses,
  with a Boleto-specific carve-out (`boleto_display_details` is treated as success, since voucher
  generation is the expected flow rather than a failure)
  (`processor/src/services/stripe-payment.service.ts`)
- Serves the Apple Pay domain-association file at `GET /applePayConfig` from
  `STRIPE_APPLE_PAY_WELL_KNOWN`, and supports Apple Pay, Google Pay, Amazon Pay and other
  Stripe-supported wallets through the Payment Element (`processor/src/routes/stripe-payment.route.ts`)

## Stripe Webhooks

- `POST /stripe/webhooks` verifies the Stripe signature against
  `STRIPE_WEBHOOK_SIGNING_SECRET` and dispatches by event type
  (`processor/src/routes/stripe-payment.route.ts`)
- `payment_intent.succeeded` / `charge.succeeded` → creates Authorization/Charge transactions;
  `payment_intent.canceled` → Authorization→Failure + CancelAuthorization:Success;
  `payment_intent.payment_failed` → Authorization→Failure
- `charge.refunded` → Refund:Success + Chargeback:Success with the exact refunded amount pulled
  from the Stripe API (only processed when `STRIPE_ENABLE_MULTI_OPERATIONS=true`; otherwise
  handled by the basic refund path)
- `charge.updated` → multicapture handling, creating incremental Charge:Success transactions
  (only when `STRIPE_ENABLE_MULTI_OPERATIONS=true`)
- `invoice.paid` / `invoice.payment_failed` / `invoice.upcoming` → routed to the subscription
  service instead of the payment service when the charge originates from a subscription invoice
  (`isFromSubscriptionInvoice`, `processor/src/utils.ts`)

## Multiple Refunds & Multicapture (opt-in)

- `STRIPE_ENABLE_MULTI_OPERATIONS=true` (requires `STRIPE_CAPTURE_METHOD=manual` and multicapture
  enabled on the Stripe account) unlocks multiple partial captures and multiple refunds per
  payment with accurate per-event amount tracking, instead of the single-capture/single-refund
  default (`processor/src/services/stripe-payment.service.ts`, `docs/multiple-refunds-multicapture.md`)

## Stripe Customer Session Management

- Resolves the Stripe customer for the commercetools customer that owns the checkout cart: looks
  up `stripeConnector_stripeCustomerId` on a commercetools `customer` custom type, creates the
  Stripe customer (tagging it with the commercetools customer ID in metadata) if it doesn't exist,
  and persists the mapping back onto the commercetools customer
  (`processor/src/services/stripe-customer.service.ts`,
  `processor/src/services/commerce-tools/customer-client.ts`)
- `GET /customer/session` returns a Stripe Customer Session (enables saved/reusable payment
  methods in the Payment Element), configurable via `STRIPE_SAVED_PAYMENT_METHODS_CONFIG`
  (disabled by default) (`processor/src/routes/stripe-customer.route.ts`)
- On deploy, creates the `payment-connector-stripe-customer-id` custom type on the `customer`
  resource to hold this mapping (`processor/src/custom-types/custom-types.ts`,
  `processor/src/connectors/post-deploy.ts`)

## Shipping Sync

- `POST /shipping-methods` and `POST /shipping-methods/update` fetch/update the cart's shipping
  rate and push it into the active Stripe PaymentIntent so Stripe's Express Checkout shipping
  selector stays in sync with commercetools shipping methods
  (`processor/src/routes/stripe-shipping.route.ts`, `processor/src/services/stripe-shipping.service.ts`)
- `GET /shipping-methods/remove` clears a previously applied shipping rate
- Customers can change their shipping/billing address directly inside Stripe Express Checkout;
  the connector re-fetches commercetools shipping rates for the new address and updates the cart

## Subscriptions (Stripe Billing)

- A dedicated commercetools product type, `payment-connector-subscription-information` (key
  `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY`), configures recurring billing per product variant —
  interval, interval count, off-session flag, collection method (`charge_automatically` /
  `send_invoice`), days-until-due, cancel-at / cancel-at-period-end, billing-cycle-anchor
  day/time/date, trial period / trial end date, missing-payment-method-at-trial-end behavior, and
  proration behavior — all under a `stripeConnector_` attribute prefix
  (`processor/src/custom-types/custom-types.ts`, `processor/src/mappers/subscription-mapper.ts`)
- Automatically picks one of three payment flows per product based on that custom type data:
  plain `payment`, immediate `subscription`, or `setupIntent` (defers the charge, e.g. for trial
  periods) — exposed as `paymentMode` from `GET /config-element/:payment`
  (`processor/src/services/stripe-subscription.service.ts`)
- `POST /setupIntent`, `POST /subscription`, `POST /subscription/withSetupIntent`, and
  `POST /subscription/confirm` drive subscription creation and confirmation from checkout
  (`processor/src/routes/stripe-subscription.route.ts`)
- Subscription Management API for back-office/administrative use, scoped to
  `manage_subscriptions`: list a customer's subscriptions
  (`GET /subscription-api/:customerId`), cancel one (`DELETE /subscription-api/:customerId/:subscriptionId`),
  switch variant/price (`POST /subscription-api/:customerId`), and apply arbitrary Stripe
  subscription-update params (`POST /subscription-api/advanced/:customerId`)
  (`processor/src/routes/stripe-subscription.route.ts`, `processor/src/services/stripe-subscription.service.ts`)
- Subscription price synchronization keeps Stripe subscription prices aligned with
  commercetools product prices — Stripe stays the source of truth for the subscription/product
  lifecycle, commercetools stays the source of truth for price. `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`
  syncs before each `invoice.upcoming` (current billing period takes the new price);
  `false` (default) updates after payment for the next cycle via `createOrder`
  (`docs/subscription-price-synchronization.md`, `processor/src/services/stripe-subscription.service.ts`)
- Recurring shipping fees: detects shipping methods on the cart at subscription creation,
  creates or reuses a Stripe recurring Price matching the subscription's billing interval for the
  shipping fee, and tracks the shipping method ID / amount in Stripe metadata
  (`docs/subscription-shipping-fee.md`, `processor/src/services/stripe-shipping.service.ts`)
- Mixed-cart support: a cart with both subscription line items and one-time line items is split
  automatically — the one-time items ride along on the subscription's first invoice, the
  subscription items get normal recurring billing (`docs/mixed-cart-support.md`)
- Stripe coupons: commercetools cart discount codes are mirrored into Stripe coupons for
  subscription checkout (creates/validates/deletes the Stripe coupon to match the commercetools
  discount, respects `StopAfterThisDiscount` stacking mode; rejects discount codes that map to
  more than one cart discount as unsupported) (`processor/src/services/stripe-coupon.service.ts`)
- `stripeConnector_` attribute-name prefixing on subscription line items/product type is
  automatically stripped/restored between the commercetools schema and Stripe's internal
  processing, with backward compatibility for non-prefixed names
  (`docs/attribute-name-standardization.md`, `processor/src/mappers/subscription-mapper.ts`)
- A dedicated price-client service exposes `getProductById` (expanded/discounted price data) and
  `getProductMasterPrice` for subscription price lookups
  (`processor/src/services/commerce-tools/price-client.ts`)
- On deploy, creates the subscription product type and the `payment-connector-subscription-line-item-type`
  line-item custom type (Stripe subscription/product-subscription IDs, subscription error field)
  (`processor/src/custom-types/custom-types.ts`, `processor/src/connectors/post-deploy.ts`)

## Frontend Payment Component (Enabler)

- Wraps the Stripe Payment Element and Express Checkout Element behind a `commercetools Connect`
  enabler contract so a storefront/Checkout can load either without depending on the Stripe SDK
  directly (`enabler/src/main.ts`, `enabler/src/payment-enabler/payment-enabler.ts`)
- `createDropinBuilder('embedded' | 'hpp')` renders the payment UI inline or redirects to a
  Stripe-hosted payment page; `createComponentBuilder('card' | ...)` builds an individual
  component (`enabler/src/dropin/dropin-embedded.ts`)
- Configurable per Enabler instance: locale, `onActionRequired`/`onComplete`/`onError` callbacks,
  `stripeCustomerId` (attach to an existing Stripe customer), and `paymentElementType`
  (`enabler/src/payment-enabler/payment-enabler.ts`)
- `stripeConfig` frontend override lets a specific integration override backend-configured
  appearance, layout, billing-address collection, and per-payment-method options (PIX expiry,
  Boleto expiry, etc.) without a backend redeploy — frontend value wins over the
  `STRIPE_APPEARANCE_*` / `STRIPE_LAYOUT` / `STRIPE_COLLECT_BILLING_ADDRESS` env vars when both
  are present (`enabler/src/services/stripe-service.ts`)
- Same `requires_action` / Boleto-voucher / `payment_failed` structured error handling as the
  processor, implemented client-side against the Stripe.js PaymentIntent object
  (`enabler/src/services/stripe-service.ts`)
- A fake/mock SDK and mock payment DTO support local enabler development without a live Stripe
  account (`enabler/src/fake-sdk.ts`, `enabler/src/dtos/mock-payment.dto.ts`)

## commercetools Integration & Connect Lifecycle

- Uses the [connect-payments-sdk](https://github.com/commercetools/connect-payments-sdk) for
  request context, session-header auth, OAuth2 client-credential auth, and JWT (Merchant Center)
  auth on every route (`processor/src/payment-sdk.ts`, `processor/src/routes/*.route.ts`)
- Drives commercetools Payment Update Actions (Authorization, Charge, Refund, Chargeback,
  CancelAuthorization) to keep the commercetools `Payment` resource's transaction history in sync
  with Stripe (`processor/src/services/ct-payment-creation.service.ts`)
- `postDeploy` (`npm run connector:post-deploy`) provisions the connector's commercetools
  dependencies on install: the launchpad purchase-order custom type, the subscription product
  type, the subscription line-item custom type, the customer Stripe-ID custom type, and
  registers/updates the Stripe webhook endpoint URL against `STRIPE_WEBHOOK_ID`
  (`processor/src/connectors/post-deploy.ts`)
- `preUndeploy` (`npm run connector:pre-undeploy`) reverses/cleans up connector-created
  commercetools resources before the connector is removed (`processor/src/connectors/pre-undeploy.ts`)
- `GET /status` (JWT-authenticated) and `GET /config` (session-authenticated) expose connector
  health and runtime configuration for the Merchant Center / Checkout integration
  (`processor/src/routes/operation.route.ts`)
- `GET /payment-components` reports which Stripe payment components (Payment Element, Express
  Checkout) the connector currently supports (`processor/src/routes/operation.route.ts`)
- All custom type / product type keys (`CT_CUSTOM_TYPE_*`, `CT_PRODUCT_TYPE_*`) and commercetools
  connection settings (project key, auth/API/session/checkout URLs, JWKS URL/issuer) are
  configurable through `connect.yaml` standard configuration; commercetools client credentials
  and Stripe secret/webhook-signing keys are `securedConfiguration` (`connect.yaml`)

## Demo / Local Tooling

- `docker-compose.yaml` (root and `processor/`) for local processor development
- Local dev/build/test/lint/prettify npm scripts in both `enabler/` and `processor/`
  (`enabler/package.json`, `processor/package.json`)
- Extensive automated test suite for the processor (subscription lifecycle, business logic, price
  sync, private methods, order creation, payment flows, coupon/shipping/customer clients, route
  handlers) under `processor/test/`, plus enabler component tests under `enabler/test/`
