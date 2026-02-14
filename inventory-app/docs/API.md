# LAN Sync API (Desktop server)

Base URL example:
- `http://<desktop-ip>:5199`

Auth header:
- `Authorization: Bearer <token>`

Auth rule:
- `GET /api/ping` is unauthenticated.
- All other `/api/*` endpoints require `Authorization: Bearer <token>`.

## Endpoints

- `GET /api/ping` (no auth)
- `GET /api/admin/token` (localhost-only)
- `GET /api/meta`

### Categories
- `GET /api/categories`
- `POST /api/categories` body: `{ "name": "Electronics" }`
- `PUT /api/categories/:id` body: `{ "name": "Electronics" }`
- `DELETE /api/categories/:id`

### Locations
- `GET /api/locations`
- `POST /api/locations` body: `{ "name": "Kitchen", "parent_id": null }`
- `PUT /api/locations/:id` body: `{ "name": "Kitchen", "parent_id": null }`
- `DELETE /api/locations/:id`

### Items
- `GET /api/items?q=&categoryId=&locationId=&since=&includeDeleted=1|0`
- `GET /api/items/:id`
- `POST /api/items`
- `PUT /api/items/:id`
- `DELETE /api/items/:id` (soft delete)

Notes:
- `GET /api/items` returns `{ items, deleted, serverTimeMs }` where `deleted` is an array of `item_id` values whose records are soft-deleted.
- `PUT /api/items/:id` enforces last-write-wins: if the request includes `last_modified` older than the server record, the server returns `409 { error: "conflict", serverItem: ... }`.

### Scanning

#### Single scan (online)

`POST /api/scan`

Purpose:
- Resolve a scanned barcode.
- If barcode exists (primary or alternate), increment item quantity.

Request:
```json
{ "barcode": "012345678905", "delta": 1 }
```

Optional idempotency:
```json
{ "barcode": "012345678905", "delta": 1, "event_id": "uuid" }
```

Response (found):
```json
{ "action": "incremented", "item": { /* updated item */ } }
```

Response (not found):
```json
{ "action": "not_found" }
```

#### Batch apply (offline-first)

`POST /api/scans/apply`

Purpose:
- Apply a batch of scan delta events idempotently (safe retries).

Request:
```json
{
	"events": [
		{ "event_id": "uuid-1", "barcode": "012345678905", "delta": 1, "scanned_at": 1730000000000 }
	]
}
```

Response:
```json
{
	"serverTimeMs": 1730000000000,
	"results": [
		{ "status": "applied", "event_id": "uuid-1", "item": { /* updated item */ } }
	]
}
```

### Alternate barcodes (combine barcode sets)

`GET /api/items/:id/barcodes`

Response:
```json
{ "barcodes": [ { "barcode": "ALT-222", "item_id": 1, "created_at": 0 } ] }
```

`POST /api/items/:id/barcodes`

Request:
```json
{ "barcode": "ALT-222" }
```

Responses:
- `200` OK
- `409` `{ "error": "barcode_in_use", "item_id": 123 }`

### Composite sync
- `POST /api/sync`

Request:
```json
{ "since": 0, "items": [ /* items with item_id + last_modified */ ] }
```

Response:
```json
{ "serverTimeMs": 0, "items": [], "deleted": [] }
```

### Backup / logs
- `GET /api/export`
- `POST /api/import` (body = export payload)
- `GET /api/sync-log?limit=50`

### Mobile incremental helpers

- `GET /api/item-barcodes?since=<ms>`
	- returns `{ serverTimeMs, barcodes: [{ barcode, item_id, created_at }, ...] }`
