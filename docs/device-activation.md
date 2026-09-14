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
- Ownership transfer uses sequential writes and works with standalone MongoDB.
  The old device document is deleted and a fresh assignment is inserted with a new
  `_id`. Old settings, patient, paper and billing fields are not transferred.
  Papers remain with their original owner. Before inserting a new assignment,
  the serial-keyed `ePaperDeviceImages/<serial>.png` comparison image is deleted
  from S3, allowing the next image to upload even if it matches the old owner's
  image. Paper originals and previews are preserved. A failed cache deletion
  stops completion and is retried on the next poll. Repeated completion for the
  same owner preserves their current data and image cache.
- If IoT succeeds but MongoDB fails, polling retries completion with fresh IoT
  proof. Partial writes are accepted: old paper links may already be detached,
  and the old device may be removed before insertion fails. No database rollback
  or transaction is used. Polling does not reset IoT; explicitly choosing Start
  again can reset an active orphan, as accepted for recovery.

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
REGISTRATION_TEST_MONGODB_URL='mongodb://127.0.0.1:27184/paperless-registration-test-local' node_modules/.bin/vitest run packages/paperlesspaper-api/tests/integration/deviceRegistration.persistence.test.ts
```

The MongoDB suite requires a disposable database whose name begins with
`paperless-registration-test-`; a standalone MongoDB is sufficient. It tests
partial failures and retry, idempotent completion, key gating, orphan repair,
cache invalidation and preservation of papers. S3 and IoT are mocked.

The review's log-isolation and hanging-poll regressions remain tracked by their
failing tests until separately addressed; this document does not claim those
paths are fixed.

Deploy the API before the updated UI: the new UI deliberately requires
`registrationCompleted` for e-paper registration success.
