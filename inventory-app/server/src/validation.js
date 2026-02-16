import { z } from 'zod';

export const ItemUpsertSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(5000).optional().nullable(),
  quantity: z.number().int().min(0).max(999999).default(1),
  barcode: z.string().max(128).optional().nullable(),
  barcode_corrupted: z.number().int().min(0).max(1).optional().nullable(),
  category_id: z.number().int().optional().nullable(),
  location_id: z.number().int().optional().nullable(),
  purchase_date: z.string().max(100).optional().nullable(),
  warranty_info: z.string().max(1000).optional().nullable(),
  value: z.number().min(0).optional().nullable(),
  serial_number: z.string().max(200).optional().nullable(),
  photo_path: z.string().max(1000).optional().nullable(),
  last_modified: z.number().int().optional(),
  deleted: z.number().int().min(0).max(1).optional()
});

export const CategorySchema = z.object({ name: z.string().min(1).max(200) });

export const LocationSchema = z.object({
  name: z.string().min(1).max(200),
  parent_id: z.number().int().optional().nullable()
});

const ScanDeltaSchema = z
  .number()
  .int()
  .refine((d) => d !== 0 && Math.abs(d) <= 100, { message: 'delta must be non-zero and within +/-100' });

export const BarcodeResolveSchema = z.object({
  barcode: z.string().min(1).max(128)
});

export const ItemBarcodeSchema = z.object({
  barcode: z.string().min(1).max(128)
});

export const ScanEventSchema = z.object({
  event_id: z.string().min(1).max(200),
  barcode: z.string().min(1).max(128),
  delta: ScanDeltaSchema.default(1),
  item_id: z.number().int().optional(),
  scanned_at: z.number().int().optional()
});

export const ScanEventsApplySchema = z.object({
  events: z.array(ScanEventSchema).max(500)
});

export const PairExchangeSchema = z.object({
  code: z.string().min(1),
  device_id: z.string().min(16),
  pubkey: z.string().min(1),
  name: z.string().optional().nullable()
});

export function nowMs() {
  return Date.now();
}
