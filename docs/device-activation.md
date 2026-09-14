# Device activation and ownership transfer

The Paperlesspaper API overrides the shared library's registration handlers for
`epd*` devices. The existing authentication, organization authorization and request
validation middleware remain in place; other device families use the original
handlers. No change or publication of `@internetderdinge/api` is required.

## API behavior

- `GET /devices/registration-status/:deviceId?organization=...` inspects the global
  local assignment and IoT state. It returns `available: true` and a `mode` of
  `activation`, `takeover`, or `already_registered`. It never resets a device.
- `POST /devices/registerdevice/:deviceId` with `enable: true` starts activation.
  An active device with a local assignment must never be reset first. An active
  orphan is reset only at the explicit start. A definitively inactive device's
  stale local assignment is removed, with its papers detached but preserved.
- Polling uses the same authorized organization and `enable: false`. IoT
  `success` without a nonempty key is returned as `timeout`, not completion.
- `registrationCompleted: true` and `createdDevice` are returned only after IoT
  confirms the target organization with a key and the local assignment is saved.
  The key stays on the server and is not persisted or included in responses.
- Ownership transfer and paper detachment use one MongoDB transaction. The
  old device document is deleted and a fresh assignment is inserted with a new
  `_id`. Old settings, patient, paper and billing fields are not transferred.
  Old image paths, logs and pending deactivation receipts remain attached to the
  old database id. Papers remain with their original owner.
  This requires a MongoDB replica set/transaction support; no non-atomic fallback
  is used. Repeated completion for the same owner preserves their current data.
- If IoT succeeds but MongoDB fails, polling retries completion with fresh IoT
  proof. It never rolls back the physical transfer by resetting the device.

## WLAN and the UI

For registration, the user can connect BLE, select WLAN and enter the password
before the five-minute activation window starts. Immediately before writing
either credential, the UI awaits activation `pending`. After the write it polls
every four seconds without starting another activation. Existing WLAN uses the
button confirmation path. Cancellation invalidates outstanding responses and
clears polling timers. The UI rejects unverified legacy `success` responses.

The ordinary **Connect new Wifi** dialog has no activation callback: it writes
credentials without sending an activation or reset request or altering local
assignments. Preserving IoT images/activation during this normal WLAN change is
also required of firmware/IoT. Daniel's supplied API documentation says `act: 0`
deletes images; the documented BLE interface has no separate non-destructive
WLAN-change command. This branch cannot change that server/firmware behavior.
Verify that IoT distinguishes normal WLAN changes from ownership transfers
before releasing this behavior end to end.

The acknowledged possibility of a normal button press confirming an unwanted
claim remains an IoT/firmware limitation. Competing claims by multiple new
organizations are outside this change's scope.

## Verification

No physical device, production API or production database is used by these tests.

```sh
node_modules/.bin/vitest run --config packages/paperlesspaper-web/vitest.config.ts tests/unit/useDeviceActivation.test.tsx tests/unit/bluetoothActivationOrder.test.tsx
REGISTRATION_TEST_MONGODB_URL='mongodb://127.0.0.1:27184/paperless-registration-test-local?replicaSet=registration-test' node_modules/.bin/vitest run packages/paperlesspaper-api/tests/integration/deviceRegistration.persistence.test.ts
```

The MongoDB suite requires a disposable replica set/database whose name begins
with `paperless-registration-test-`. It tests real transactions, rollback,
idempotent completion, key gating, orphan repair and preservation of papers.

Deploy the API before the updated UI: the new UI deliberately requires
`registrationCompleted` for e-paper registration success.
