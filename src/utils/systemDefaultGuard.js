'use strict';

const ApiError = require('./ApiError');

/**
 * Throws a 403 ApiError if the given record is a system-default row.
 *
 * Call this in update and delete service methods AFTER the 404 guard (so the
 * record is already fetched) and BEFORE any mutation.
 *
 * @param {object|null} record    - The already-fetched DB record
 * @param {string}      entityName - Human-readable name used in the error message
 * @throws {ApiError} 403 with code SYSTEM_DEFAULT_LOCKED
 */
function assertNotSystemDefault(record, entityName) {
  if (record && record.isSystemDefault) {
    throw new ApiError(
      403,
      'SYSTEM_DEFAULT_LOCKED',
      `${entityName} is a system default and cannot be modified or deleted.`,
    );
  }
}

module.exports = { assertNotSystemDefault };
