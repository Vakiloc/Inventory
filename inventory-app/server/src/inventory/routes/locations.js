import express from 'express';

import { parseIntParam, parseJsonBody, sendError, sendOk, wrapRoute } from '../../http.js';
import { LocationSchema } from '../../validation.js';
import {
  createLocation,
  deleteLocation,
  listLocations,
  updateLocation
} from '../repo.js';

export function createLocationsRouter({ requireAuth, requireEdit }) {
  if (typeof requireAuth !== 'function') throw new Error('createLocationsRouter: requireAuth is required');
  if (typeof requireEdit !== 'function') throw new Error('createLocationsRouter: requireEdit is required');

  const router = express.Router();

  router.get(
    '/locations',
    requireAuth,
    wrapRoute((req, res) => {
      sendOk(res, { locations: listLocations(req.db) });
    })
  );

  router.post(
    '/locations',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const data = parseJsonBody(LocationSchema, req, res);
      if (!data) return;
      sendOk(res, { location: createLocation(req.db, data) });
    })
  );

  router.put(
    '/locations/:id',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const id = parseIntParam(req, res, 'id');
      if (!id) return;

      const data = parseJsonBody(LocationSchema, req, res);
      if (!data) return;

      try {
        const updated = updateLocation(req.db, id, data);
        if (!updated) return sendError(res, 404, 'not_found');
        sendOk(res, { location: updated });
      } catch (err) {
        if (String(err?.message || err).includes('UNIQUE')) {
          return sendError(res, 409, 'Location name already exists');
        }
        throw err;
      }
    })
  );

  router.delete(
    '/locations/:id',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const id = parseIntParam(req, res, 'id');
      if (!id) return;
      deleteLocation(req.db, id);
      sendOk(res, { ok: true });
    })
  );

  return router;
}
