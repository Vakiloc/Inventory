import { z } from 'zod';

export const ItemUpsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  quantity: z.number().int().min(0).default(1),
  barcode: z.string().optional().nullable(),
  barcode_corrupted: z.number().int().min(0).max(1).optional().nullable(),
  category_id: z.number().int().optional().nullable(),
  location_id: z.number().int().optional().nullable(),
  purchase_date: z.string().optional().nullable(),
  warranty_info: z.string().optional().nullable(),
  value: z.number().optional().nullable(),
  serial_number: z.string().optional().nullable(),
  photo_path: z.string().optional().nullable(),
  last_modified: z.number().int().optional(),
  deleted: z.number().int().optional()
});

export const CategorySchema = z.object({ name: z.string().min(1) });

export const LocationSchema = z.object({
  name: z.string().min(1),
  parent_id: z.number().int().optional().nullable()
});

const ScanDeltaSchema = z
  .number()
  .int()
  .refine((d) => d !== 0 && Math.abs(d) <= 100, { message: 'delta must be non-zero and within +/-100' });

export const BarcodeResolveSchema = z.object({
  barcode: z.string().min(1)
});

export const BarcodeScanSchema = z.object({
  barcode: z.string().min(1),
  delta: ScanDeltaSchema.optional().default(1),
  event_id: z.string().min(1).optional(),
  item_id: z.number().int().optional(),
  override: z.boolean().optional()
});

export const ItemBarcodeSchema = z.object({
  barcode: z.string().min(1)
});

export const ScanEventSchema = z.object({
  event_id: z.string().min(1),
  barcode: z.string().min(1),
  delta: ScanDeltaSchema.default(1),
  item_id: z.number().int().optional(),
  override: z.boolean().optional(),
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
